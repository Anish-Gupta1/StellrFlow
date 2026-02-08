"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Send, CheckCircle2, AlertCircle, Loader2, ArrowRight } from "lucide-react";
import {
  isConnected,
  getAddress,
  signTransaction,
} from "@stellar/freighter-api";

const STELLAR_BOT_URL = process.env.NEXT_PUBLIC_STELLAR_BOT_URL || "http://localhost:3003";

export default function SendTransactionPage() {
  const searchParams = useSearchParams();
  const chatId = searchParams.get("chatId");
  const prefillDestination = searchParams.get("destination") || "";
  const prefillAmount = searchParams.get("amount") || "";
  const network = searchParams.get("network") || "testnet";

  const [status, setStatus] = useState<"idle" | "loading" | "signing" | "success" | "error">("idle");
  const [destination, setDestination] = useState(prefillDestination);
  const [amount, setAmount] = useState(prefillAmount);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freighterInstalled, setFreighterInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    const checkFreighter = async () => {
      try {
        await new Promise((r) => setTimeout(r, 500));
        const result = await isConnected();

        if (result.isConnected) {
          setFreighterInstalled(true);
          try {
            const addressResult = await getAddress();
            if (addressResult.address) {
              setPublicKey(addressResult.address);
            }
          } catch (e) {
            console.log("Could not get address:", e);
          }
        } else {
          setFreighterInstalled(false);
        }
      } catch (e) {
        setFreighterInstalled(false);
      }
    };

    checkFreighter();
  }, []);

  const sendTransaction = async () => {
    if (!destination || !amount || !publicKey) {
      setError("Please fill in all fields and connect Freighter");
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError("Invalid amount");
      return;
    }

    setStatus("loading");
    setError(null);

    try {
      // Step 1: Build unsigned transaction on backend
      const buildResponse = await fetch(`${STELLAR_BOT_URL}/api/transaction/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceAddress: publicKey,
          destination,
          amount: amountNum.toFixed(7),
          network,
        }),
      });

      const buildResult = await buildResponse.json();
      if (!buildResult.success) {
        throw new Error(buildResult.error || "Failed to build transaction");
      }

      setStatus("signing");

      // Step 2: Sign with Freighter
      const signResult = await signTransaction(buildResult.xdr, {
        networkPassphrase: network === "testnet"
          ? "Test SDF Network ; September 2015"
          : "Public Global Stellar Network ; September 2015",
      });

      if (signResult.error) {
        throw new Error(signResult.error.message || "Failed to sign transaction");
      }

      // Step 3: Submit signed transaction
      const submitResponse = await fetch(`${STELLAR_BOT_URL}/api/transaction/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signedXdr: signResult.signedTxXdr,
          chatId,
          network,
        }),
      });

      const submitResult = await submitResponse.json();
      if (!submitResult.success) {
        throw new Error(submitResult.error || "Failed to submit transaction");
      }

      setTxHash(submitResult.hash);
      setStatus("success");

      // Notify Telegram
      if (chatId) {
        const message =
          `✅ **Transaction Successful!**\n\n` +
          `**Sent:** ${amount} XLM\n` +
          `**To:** \`${destination.slice(0, 8)}...${destination.slice(-8)}\`\n\n` +
          `🔗 [View on Explorer](https://stellar.expert/explorer/${network}/tx/${submitResult.hash})`;

        await fetch(`${STELLAR_BOT_URL}/api/telegram/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, message }),
        });
      }
    } catch (err: any) {
      console.error("Transaction error:", err);
      setError(err.message || "Transaction failed");
      setStatus("error");

      // Notify Telegram of failure
      if (chatId) {
        await fetch(`${STELLAR_BOT_URL}/api/telegram/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId,
            message: `❌ Transaction failed: ${err.message || "Unknown error"}`,
          }),
        });
      }
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Send className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Send XLM</CardTitle>
          <CardDescription>
            Sign and send a transaction with your Freighter wallet
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {freighterInstalled === null ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Detecting Freighter...</p>
            </div>
          ) : freighterInstalled === false ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-4 rounded-lg bg-yellow-500/10 text-yellow-500">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <p className="text-sm">Freighter wallet extension not detected</p>
              </div>
              <Button onClick={() => window.open("https://www.freighter.app/", "_blank")} className="w-full">
                Install Freighter
              </Button>
            </div>
          ) : status === "success" ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-4 rounded-lg bg-green-500/10 text-green-500">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium">Transaction Successful!</p>
                  <p className="text-xs opacity-80 font-mono">
                    {txHash?.slice(0, 16)}...
                  </p>
                </div>
              </div>
              <Button
                onClick={() => window.open(`https://stellar.expert/explorer/${network}/tx/${txHash}`, "_blank")}
                variant="outline"
                className="w-full"
              >
                View on Explorer
              </Button>
              {chatId && (
                <p className="text-sm text-center text-muted-foreground">
                  ✅ Telegram notified! You can close this page.
                </p>
              )}
            </div>
          ) : status === "error" ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-4 rounded-lg bg-red-500/10 text-red-500">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
              <Button onClick={() => setStatus("idle")} className="w-full">
                Try Again
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {publicKey && (
                <div className="p-3 rounded-lg bg-muted">
                  <p className="text-xs text-muted-foreground">From</p>
                  <p className="text-sm font-mono truncate">{publicKey}</p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="destination">Destination Address</Label>
                <Input
                  id="destination"
                  placeholder="GABC...XYZ"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  disabled={status !== "idle"}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="amount">Amount (XLM)</Label>
                <Input
                  id="amount"
                  type="number"
                  placeholder="10"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={status !== "idle"}
                />
              </div>

              <Button
                onClick={sendTransaction}
                className="w-full"
                disabled={status !== "idle" || !publicKey}
              >
                {status === "loading" ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Building Transaction...
                  </>
                ) : status === "signing" ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sign in Freighter...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Send XLM
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                Network: {network} • You'll be prompted to sign in Freighter
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
