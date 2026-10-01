export interface ReadingBlockClaimOwner {
	readonly isConnected: boolean;
}

export interface ReadingBlockClaimRegistry<
	Owner extends ReadingBlockClaimOwner
> {
	readonly size: number;
	claim(key: string, owner: Owner): boolean;
	release(key: string, owner: Owner): void;
}

const DEFAULT_MAX_RETAINED_CLAIMS = 200;

export function createReadingBlockClaimRegistry<
	Owner extends ReadingBlockClaimOwner
>(
	maxRetainedClaims = DEFAULT_MAX_RETAINED_CLAIMS
): ReadingBlockClaimRegistry<Owner> {
	const claims = new Map<string, Owner>();
	const retainedClaimLimit = Math.max(1, Math.floor(maxRetainedClaims));

	function removeDisconnectedClaims(): void {
		for (const [key, owner] of claims) {
			if (!owner.isConnected) {
				claims.delete(key);
			}
		}
	}

	return {
		get size(): number {
			return claims.size;
		},
		claim(key, owner): boolean {
			const currentOwner = claims.get(key);
			if (currentOwner && currentOwner !== owner && currentOwner.isConnected) {
				return false;
			}

			claims.set(key, owner);
			if (claims.size > retainedClaimLimit) {
				removeDisconnectedClaims();
			}
			return true;
		},
		release(key, owner): void {
			if (claims.get(key) === owner) {
				claims.delete(key);
			}
		}
	};
}
