"use client";

import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Trash2, Copy, Settings, Info, ArrowRight } from 'lucide-react';
import { useWorkflowStore } from '@/lib/stores/workflow-store';
import { getIconByName } from '@/lib/utils/icons';
import { motion, AnimatePresence } from 'framer-motion';

export function PropertiesPanel() {
  const {
    selectedNode,
    selectedEdge,
    updateNodeData,
    duplicateNode,
    deleteNode,
    deleteEdge
  } = useWorkflowStore();

  return (
    <div className="w-72 border-l border-border bg-card flex flex-col">
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-medium">Properties</h2>
      </div>

      <ScrollArea className="flex-1">
        <AnimatePresence mode="wait">
          {selectedNode && (
            <motion.div
              key={selectedNode.id}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
              className="p-4"
            >
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 rounded-md bg-muted">
                  {getIconByName(selectedNode.data.icon)}
                </div>
                <div>
                  <h3 className="font-medium">{selectedNode.data.label}</h3>
                  <p className="text-xs text-muted-foreground">{selectedNode.data.type}</p>
                </div>
              </div>

              <Tabs defaultValue="settings">
                <TabsList className="w-full">
                  <TabsTrigger value="settings" className="flex-1">
                    <Settings className="h-4 w-4 mr-1" />
                    Settings
                  </TabsTrigger>
                  <TabsTrigger value="info" className="flex-1">
                    <Info className="h-4 w-4 mr-1" />
                    Info
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="settings" className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="node-name">Name</Label>
                    <Input
                      id="node-name"
                      value={selectedNode.data.label}
                      onChange={(e) => updateNodeData(selectedNode.id, { label: e.target.value })}
                    />
                  </div>

                  {selectedNode.data.config && Object.entries(selectedNode.data.config).map(([key, value]) => (
                    <div className="space-y-2" key={key}>
                      <Label htmlFor={`config-${key}`}>{key.charAt(0).toUpperCase() + key.slice(1)}</Label>
                      <Input
                        id={`config-${key}`}
                        value={value as string}
                        onChange={(e) => {
                          console.log(`Updating ${key} to ${e.target.value}`);
                          try {
                            const newConfig = { ...selectedNode.data.config };
                            newConfig[key] = e.target.value;
                            updateNodeData(selectedNode.id, { config: newConfig });
                          } catch (error) {
                            console.error('Error updating node config:', error);
                          }
                        }}
                        onBlur={(e) => {
                          console.log(`Finished editing ${key}, value: ${e.target.value}`);
                          try {
                            const newConfig = { ...selectedNode.data.config };
                            newConfig[key] = e.target.value;
                            updateNodeData(selectedNode.id, { config: newConfig });
                          } catch (error) {
                            console.error('Error updating node config on blur:', error);
                          }
                        }}
                      />
                    </div>
                  ))}

                  <Separator />

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => duplicateNode(selectedNode.id)}
                    >
                      <Copy className="h-4 w-4 mr-1" />
                      Duplicate
                    </Button>
                    <Button
                      variant="destructive"
                      className="flex-1"
                      onClick={() => deleteNode(selectedNode.id)}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Delete
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="info" className="pt-4">
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-medium">Description</h4>
                      <p className="text-sm text-muted-foreground">{selectedNode.data.description}</p>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium">Input/Output</h4>
                      <p className="text-sm text-muted-foreground">
                        This node accepts data from previous steps and passes its result to the next step.
                      </p>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </motion.div>
          )}

          {selectedEdge && (
            <motion.div
              key={selectedEdge.id}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="p-4"
            >
              <h3 className="font-medium mb-2">Edge Properties</h3>
              <p className="text-sm text-muted-foreground mb-4">
                This connection transfers data from one step to another.
              </p>

              <div className="space-y-4">
                <div className="p-3 rounded-md bg-muted flex items-center space-x-2">
                  <div className="h-2 w-2 rounded-full bg-primary" />
                  <div className="text-sm">From: {selectedEdge.source}</div>
                </div>

                <div className="flex items-center justify-center my-2">
                  <ArrowRight className="h-5 w-5 text-muted-foreground" />
                </div>

                <div className="p-3 rounded-md bg-muted flex items-center space-x-2">
                  <div className="h-2 w-2 rounded-full bg-accent" />
                  <div className="text-sm">To: {selectedEdge.target}</div>
                </div>

                <div className="pt-4">
                  <Button
                    variant="destructive"
                    className="w-full"
                    onClick={() => deleteEdge(selectedEdge.id)}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete Connection
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {!selectedNode && !selectedEdge && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-4 text-center"
            >
              <div className="py-8">
                <div className="mx-auto rounded-full bg-muted w-12 h-12 flex items-center justify-center mb-4">
                  <Settings className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="font-medium mb-1">No element selected</h3>
                <p className="text-sm text-muted-foreground">
                  Select a node or connection to view and edit its properties
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </ScrollArea>
    </div>
  );
}