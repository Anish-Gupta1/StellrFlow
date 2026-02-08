"use client";

import { Handle, Position, NodeProps } from "@reactflow/core";
import { motion } from "framer-motion";
import { NodeData, useWorkflowStore } from "@/lib/stores/workflow-store";
import { getIconByName } from "@/lib/utils/icons";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

export function CustomNode({ data, id, selected }: NodeProps<NodeData>) {
    const Icon = getIconByName(data.icon);
    const { nodeExecutionState, nodeResults, isWorkflowRunning } =
        useWorkflowStore();
    const nodeState = nodeExecutionState[id];
    const nodeResult = nodeResults[id];

    function renderStateIndicator() {
        switch (nodeState) {
            case "running":
                return (
                    <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                );
            case "success":
                return <CheckCircle2 className="h-4 w-4 text-green-500" />;
            case "error":
                return <AlertCircle className="h-4 w-4 text-red-500" />;
            default:
                return null;
        }
    }

    return (
        <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.2 }}
            className={`w-56 rounded-lg border shadow-sm bg-card overflow-hidden ${
                selected ? "ring-2 ring-primary" : ""
            }`}
        >
            <div
                className={`p-3 font-medium border-b flex items-center gap-2                 ${
                    data.type.includes("trigger") ||
                    data.type === "telegram-trigger"
                        ? "bg-mauve/20"
                        : data.type.includes("action") ||
                          data.type === "stellar-sdk" ||
                          data.type === "telegram-send" ||
                          data.type === "wallet-integration"
                        ? "bg-sapphire/20"
                        : "bg-peach/20"
                }`}
            >
                <div className="text-primary">{Icon}</div>
                <div className="truncate flex-1">{data.label}</div>
                <div>{renderStateIndicator()}</div>
            </div>

            <div className="p-3 text-xs text-muted-foreground">
                {data.description}
            </div>

            {/* Input handle on the left */}
            <Handle 
                type="target" 
                position={Position.Left} 
                id="in"
                className="!w-3 !h-3 !bg-primary !border-2 !border-background hover:!bg-accent !-left-1.5"
                isConnectable={true}
            />

            {/* Output handle on the right */}
            <Handle 
                type="source" 
                position={Position.Right} 
                id="out"
                className="!w-3 !h-3 !bg-primary !border-2 !border-background hover:!bg-accent !-right-1.5"
                isConnectable={true}
            />
        </motion.div>
    );
}
