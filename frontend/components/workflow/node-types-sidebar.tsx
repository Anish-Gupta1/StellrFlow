"use client";

import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { NODE_TYPES } from "@/lib/stores/workflow-store";
import { NodeCategory } from "./node-category";

export function NodeTypesSidebar() {
    const [searchTerm, setSearchTerm] = useState("");

    // Filter node types based on search
    const filteredNodeTypes = Object.entries(NODE_TYPES).reduce<
        Record<string, any>
    >((acc, [key, category]) => {
        if (searchTerm === "") {
            acc[key] = category;
            return acc;
        }

        const filteredItems = category.items.filter(
            (item) =>
                item.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.description
                    .toLowerCase()
                    .includes(searchTerm.toLowerCase())
        );

        if (filteredItems.length > 0) {
            acc[key] = {
                ...category,
                items: filteredItems,
            };
        }

        return acc;
    }, {});

    return (
        <div className="w-64 border-r border-border bg-card flex flex-col">
            <div className="p-4 border-b border-border">
                <h2 className="text-lg font-medium mb-2">Workflow Steps</h2>
                <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search nodes..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-8"
                    />
                </div>
            </div>

            <ScrollArea className="flex-1 p-4">
                {Object.entries(filteredNodeTypes).map(([key, category]) => (
                    <NodeCategory
                        key={key}
                        categoryKey={key}
                        category={category}
                    />
                ))}

                {Object.keys(filteredNodeTypes).length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                        No nodes match your search
                    </div>
                )}
            </ScrollArea>
        </div>
    );
}
