"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import {
  isConnected,
  getAddress,
  getNetwork,
  isAllowed,
  setAllowed,
  requestAccess,
} from "@stellar/freighter-api";

const STELLAR_BOT_URL = process.env.NEXT_PUBLIC_STELLAR_BOT_URL || "http://localhost:3003";

export default function ConnectWalletPage() {
  const searchParams = useSearchParams();
  const chatId = searchParams.get("chatId");
  
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freighterInstalled, setFreighterInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if Freighter is installed
    const checkFreighter = async () => {
      try {
        // Wait a bit for extension to inject
        await new Promise((r) => setTimeout(r, 500));
        
        const result = await isConnected();
        
        if (result.isConnected) {
          setFreighterInstalled(true);
          
          // Check if already allowed
          const allowedResult = await isAllowed();
          if (allowedResult.isAllowed) {
            try {
              const addressResult = await getAddress();
              if (addressResult.address) {
                setPublicKey(addressResult.address);
                setStatus("connected");
              }
            } catch (e) {
              console.log("Could not get address:", e);
            }
          }
        } else {
          setFreighterInstalled(false);
        }
      } catch (e) {
        console.log("Freighter check error:", e);
        setFreighterInstalled(false);
      }
    };

    checkFreighter();
  }, []);

  const connectWallet = async () => {
    setStatus("connecting");
    setError(null);

    try {
      // First check if connected
      const connectedResult = await isConnected();
      if (!connectedResult.isConnected) {
        throw new Error("Freighter is not installed or not accessible.");
      }

      // Request access (this prompts the user and returns address)
      const accessResult = await requestAccess();
      
      if (accessResult.error) {
        throw new Error(accessResult.error.message || "Failed to get access");
      }
      
      if (!accessResult.address) {
        throw new Error("No address returned. Please approve the connection in Freighter.");
      }

      let network = "TESTNET";
      try {
        const networkResult = await getNetwork();
        network = networkResult.network || "TESTNET";
      } catch (e) {
        console.log("Could not get network:", e);
      }
      
      setPublicKey(accessResult.address);
      setStatus("connected");

      // Notify the Telegram bot about the wallet connection
      if (chatId) {
        const key = accessResult.address;
        const message = 
          `✅ **Wallet Connected!**\n\n` +
          `🔑 Address: \`${key.slice(0, 8)}...${key.slice(-8)}\`\n` +
          `🌐 Network: ${network}\n\n` +
          `You can now:\n` +
          `• Check your balance: /balance ${key}\n` +
          `• Sign transactions when prompted\n\n` +
          `_Powered by Freighter & Stellar_`;

        await fetch(`${STELLAR_BOT_URL}/api/telegram/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, message }),
        });
      }
    } catch (err: any) {
      console.error("Wallet connection error:", err);
      setError(err.message || "Failed to connect wallet. Please try again.");
      setStatus("error");
    }
  };

  const installFreighter = () => {
    window.open("https://www.freighter.app/", "_blank");
  };

  const refreshPage = () => {
    window.location.reload();
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Wallet className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Connect Wallet</CardTitle>
          <CardDescription>
            Connect your Freighter wallet to interact with Stellar via Telegram
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
              <Button onClick={installFreighter} className="w-full">
                Install Freighter
              </Button>
              <Button onClick={refreshPage} variant="outline" className="w-full">
                I already installed it - Refresh
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                Make sure Freighter is enabled in your browser extensions
              </p>
            </div>
          ) : status === "connected" ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-4 rounded-lg bg-green-500/10 text-green-500">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium">Wallet Connected!</p>
                  <p className="text-xs opacity-80 font-mono">
                    {publicKey?.slice(0, 12)}...{publicKey?.slice(-12)}
                  </p>
                </div>
              </div>
              {chatId && (
                <p className="text-sm text-center text-muted-foreground">
                  ✅ Telegram notified! You can close this page and return to Telegram.
                </p>
              )}
            </div>
          ) : status === "error" ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-4 rounded-lg bg-red-500/10 text-red-500">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
              <Button onClick={connectWallet} className="w-full">
                Try Again
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {chatId && (
                <p className="text-sm text-center text-muted-foreground">
                  Connecting wallet for Telegram chat
                </p>
              )}
              <Button
                onClick={connectWallet}
                className="w-full"
                disabled={status === "connecting"}
              >
                {status === "connecting" ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Wallet className="w-4 h-4 mr-2" />
                    Connect Freighter
                  </>
                )}
              </Button>
            </div>
          )}

          <div className="pt-4 border-t">
            <p className="text-xs text-center text-muted-foreground">
              By connecting, you allow StellrFlow to request transaction signatures.
              Your private keys never leave Freighter.
            </p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
