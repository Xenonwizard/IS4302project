"use client";

/**
 * Everything the app needs to know about the connected wallet, read straight from the chain
 * in one multicall (wagmi batches the four `eth_call`s into a single RPC request).
 */
import { zeroAddress } from "viem";
import { useAccount, useBalance, useBlockNumber, useBytecode, useReadContracts } from "wagmi";
import { ACCOUNT_STATUS, IS_DEPLOYED, chain, contracts, fromUsdcUnits } from "./config";

export function useOnchainAccount() {
  const { address, isConnected, chainId } = useAccount();
  const who = address ?? zeroAddress;
  const enabled = Boolean(address) && IS_DEPLOYED;

  // Can we reach the chain at all? A stopped `npm run chain` fails this within one 15s check.
  const { isError: unreachable } = useBlockNumber({ query: { refetchInterval: 15_000, retry: false } });

  // Is there contract code at the registry address? A restarted local chain has none until redeploy.
  const { data: code, isFetched: codeChecked } = useBytecode({ address: contracts.accounts.address, query: { enabled: IS_DEPLOYED } });

  const { data, refetch, isFetched } = useReadContracts({
    contracts: [
      { ...contracts.accounts, functionName: "accountOf", args: [who] },
      { ...contracts.accounts, functionName: "balanceOf", args: [who] },
      { ...contracts.usdc, functionName: "balanceOf", args: [who] },
      { ...contracts.slabVault, functionName: "vaultedCount", args: [who] },
      { ...contracts.usdc, functionName: "allowance", args: [who, contracts.accounts.address] },
    ],
    query: { enabled },
  });
  const { data: gas, refetch: refetchGas } = useBalance({ address, query: { enabled: Boolean(address) } });

  const record = data?.[0]?.result;
  const status = record ? ACCOUNT_STATUS[record.status] : "None";

  return {
    address,
    isConnected,
    wrongChain: isConnected && chainId !== chain.id,
    /** the RPC answers (false when the local Hardhat node isn't running) */
    reachable: !unreachable,
    /** contracts exist on the chain the app is pointed at */
    deployed: IS_DEPLOYED && (!codeChecked || Boolean(code && code !== "0x")),
    loaded: isFetched,
    status,
    handle: record?.handle ?? "",
    openedAt: record?.openedAt ? new Date(Number(record.openedAt) * 1000) : null,
    closedAt: record?.closedAt ? new Date(Number(record.closedAt) * 1000) : null,
    /** USDC held for this account inside AccountRegistry */
    custodyBalance: fromUsdcUnits(data?.[1]?.result ?? BigInt(0)),
    /** USDC sitting in the wallet itself */
    walletUsdc: fromUsdcUnits(data?.[2]?.result ?? BigInt(0)),
    vaultedCount: Number(data?.[3]?.result ?? 0),
    allowance: fromUsdcUnits(data?.[4]?.result ?? BigInt(0)),
    gasBalance: gas ? Number(gas.value) / 1e18 : 0,
    gasSymbol: gas?.symbol ?? chain.nativeCurrency.symbol,
    refetch: async () => {
      await Promise.all([refetch(), refetchGas()]);
    },
  };
}
