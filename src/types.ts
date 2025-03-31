export type Address = string;

export type Asset = {
    id: string;
    address: Address;
    symbol: string;
    decimals: number;
    name: string;
};

export type Owner = {
    id: string;
    address: Address;
};

export type WalletAddress = {
    id: string;
    address: Address;
    owners?: Owner[];
    data?: any; // For Squads-specific data (e.g., createKey, threshold)
};

export enum TransactionVerificationStatus {
    Pending = "Pending",
    Confirmed = "Confirmed",
    Failed = "Failed",
}

export interface IWalletProvider {
    createWallet(owners?: Owner[]): Promise<WalletAddress>;
    getAddress(walletAddress: WalletAddress): Promise<string>;
    getBalance(walletAddress: WalletAddress, asset: Asset): Promise<string>;
    transferToken(
        walletAddress: WalletAddress,
        tokenAddress: Address,
        recipientAddress: Address,
        amount: bigint
    ): Promise<string>;
    verifyTokenTransfer(
        walletAddress: WalletAddress,
        tokenAddress: Address,
        recipientAddress: Address,
        amount: bigint,
        transactionHash: string
    ): Promise<TransactionVerificationStatus>;
}

// Mock external signer interface
export interface IExternalSigner {
    sign(transaction: Buffer): Promise<string>;
}