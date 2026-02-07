import { create } from "zustand";
import { nanoid } from "nanoid";
// Use ReactFlow's utility functions for applying changes
import {
  applyNodeChanges,
  applyEdgeChanges,
  Node as ReactFlowNode,
  Edge as ReactFlowEdge,
  NodeChange as ReactFlowNodeChange,
  EdgeChange as ReactFlowEdgeChange,
  XYPosition,
  CoordinateExtent,
  Position,
} from "@reactflow/core";
import "@reactflow/core/dist/style.css";

// Define the type interfaces we need
export type Node<T = any> = any;

export type Edge<T = any> = any;

export type NodeChange = any;
export type EdgeChange = any;

export type NodeData = {
  label: string;
  type: string;
  icon: string;
  description: string;
  config: Record<string, any>;
};

type WorkflowState = {
  nodes: Node<NodeData>[];
  edges: Edge[];
  selectedNode: Node<NodeData> | null;
  selectedEdge: Edge | null;
  isWorkflowRunning: boolean;
  nodeExecutionState: Record<
    string,
    "pending" | "running" | "success" | "error"
  >;
  nodeResults: Record<string, any>;

  // Node actions
  setNodes: (nodes: Node<NodeData>[]) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  addNode: (nodeType: string, position: XYPosition) => void;
  updateNodeData: (nodeId: string, data: Partial<NodeData>) => void;
  duplicateNode: (nodeId: string) => void;
  deleteNode: (nodeId: string) => void;

  // Edge actions
  setEdges: (edges: Edge[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  addEdge: (params: {
    source: string;
    sourceHandle: string | null;
    target: string;
    targetHandle: string | null;
  }) => void;
  deleteEdge: (edgeId: string) => void;

  // Selection actions
  setSelectedNode: (node: Node<NodeData> | null) => void;
  setSelectedEdge: (edge: Edge | null) => void;

  // Workflow execution
  startWorkflow: () => Promise<void>;
  stopWorkflow: () => Promise<void>;
  executeNode: (nodeId: string, inputData?: any) => Promise<any>;

  // Save/Load
  saveWorkflow: () => void;
  loadWorkflow: () => void;
};

// Node type definitions for the sidebar
export const NODE_TYPES = {
  trigger: {
    category: "Triggers",
    items: [
      {
        type: "telegram-receive",
        label: "Receive Telegram",
        icon: "messageCircle",
        description: "Receive messages and files from Telegram bot",
        config: {
          checkInterval: "10", // seconds
          messageTypes: "all", // all, photo, document, etc.
          maxFileSizeInMB: "50",
        },
      },
      {
        type: "crypto-price-trigger",
        label: "Token Price",
        icon: "trendingUp",
        description: "Trigger when a cryptocurrency reaches a target price",
        config: {
          token: "arweave", // arweave or ao
          targetPrice: "15.00", // target price in USD
          comparisonType: "above", // above or below
          checkInterval: "30", // seconds
        },
      },
      {
        type: "apm-version-trigger",
        label: "APM Version",
        icon: "package",
        description: "Trigger when a new version of an Arweave package is published",
        config: {
          packageName: "markdown", // package name to monitor
          checkInterval: "60", // seconds
        },
      },
    ],
  },
  action: {
    category: "Actions",
    items: [
      {
        type: "telegram",
        label: "Send Telegram",
        icon: "messageCircle",
        description: "Send a Telegram message",
        config: { chatId: "", message: "" },
      },
      {
        type: "arweave-upload",
        label: "Upload to Arweave",
        icon: "upload",
        description: "Upload files to Arweave permanent storage",
        config: {
          tags: "", // comma-separated list of tags for the file
          permanent: "true", // Store permanently
        },
      },
    ],
  },
  logic: {
    category: "Logic",
    items: [
      {
        type: "delay",
        label: "Delay",
        icon: "clock",
        description: "Add a delay",
        config: { delay: 5 },
      },
    ],
  },
};

// Helper to get node data from type
export const getNodeDataFromType = (nodeType: string): NodeData | null => {
  for (const category of Object.values(NODE_TYPES)) {
    const item = category.items.find((item) => item.type === nodeType);
    if (item) {
      return { ...item };
    }
  }
  return null;
};

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNode: null,
  selectedEdge: null,
  isWorkflowRunning: false,
  nodeExecutionState: {},
  nodeResults: {},

  setNodes: (nodes) => set({ nodes }),
  onNodesChange: (changes) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },

  addNode: (nodeType, position) => {
    const nodeData = getNodeDataFromType(nodeType);
    if (!nodeData) return;

    const newNode: Node<NodeData> = {
      id: nanoid(),
      type: "customNode",
      position,
      data: nodeData,
    };

    set((state) => ({
      nodes: [...state.nodes, newNode],
      selectedNode: newNode,
    }));
  },

  updateNodeData: (nodeId, data) => {
    try {
      console.log(`Updating node ${nodeId} with data:`, data);

      set((state) => {
        // Find the node first to make sure it exists
        const node = state.nodes.find((n) => n.id === nodeId);
        if (!node) {
          console.error(`Node with ID ${nodeId} not found.`);
          return state; // Return unchanged state
        }

        // If config is being updated, make sure we merge properly
        let updatedData = { ...data };
        if (data.config) {
          updatedData.config = {
            ...node.data.config,
            ...data.config,
          };
          console.log("Updated config:", updatedData.config);
        }

        // Create new nodes array with updated node
        const updatedNodes = state.nodes.map((node) => {
          if (node.id === nodeId) {
            return {
              ...node,
              data: {
                ...node.data,
                ...updatedData,
              },
            };
          }
          return node;
        });

        // Log the update so we can see it in the console
        const updatedNode = updatedNodes.find((n) => n.id === nodeId);
        console.log(
          `Node ${nodeId} updated successfully:`,
          updatedNode?.data
        );

        return {
          nodes: updatedNodes,
          // Also update selectedNode if it matches the updated node
          selectedNode:
            state.selectedNode?.id === nodeId
              ? updatedNodes.find((n) => n.id === nodeId) ||
              state.selectedNode
              : state.selectedNode,
        };
      });
    } catch (error) {
      console.error("Error updating node data:", error);
    }
  },

  duplicateNode: (nodeId) => {
    const node = get().nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const newNode: Node<NodeData> = {
      ...node,
      id: nanoid(),
      position: {
        x: node.position.x + 50,
        y: node.position.y + 50,
      },
    };

    set((state) => ({
      nodes: [...state.nodes, newNode],
      selectedNode: newNode,
    }));
  },

  deleteNode: (nodeId) => {
    set((state) => {
      // Remove associated edges
      const newEdges = state.edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId
      );

      return {
        nodes: state.nodes.filter((node) => node.id !== nodeId),
        edges: newEdges,
        selectedNode:
          state.selectedNode?.id === nodeId
            ? null
            : state.selectedNode,
      };
    });
  },

  setEdges: (edges) => set({ edges }),
  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
  },

  addEdge: (params) => {
    // Check if connection already exists to prevent duplicates
    const exists = get().edges.some(
      (edge) =>
        edge.source === params.source &&
        edge.target === params.target &&
        edge.sourceHandle === params.sourceHandle &&
        edge.targetHandle === params.targetHandle
    );

    if (exists) return;

    const newEdge: Edge = {
      id: nanoid(),
      ...params,
      type: "smoothstep",
      animated: true,
    };

    set((state) => ({
      edges: [...state.edges, newEdge],
    }));
  },

  deleteEdge: (edgeId) => {
    set((state) => ({
      edges: state.edges.filter((edge) => edge.id !== edgeId),
      selectedEdge:
        state.selectedEdge?.id === edgeId ? null : state.selectedEdge,
    }));
  },

  setSelectedNode: (node) => set({ selectedNode: node }),
  setSelectedEdge: (edge) => set({ selectedEdge: edge }),

  // Workflow execution
  startWorkflow: async () => {
    try {
      set({
        isWorkflowRunning: true,
        nodeExecutionState: {},
        nodeResults: {},
      });

      // Find trigger nodes (nodes without incoming edges)
      const { nodes, edges } = get();
      const triggerNodes = nodes.filter(
        (node) => !edges.some((edge) => edge.target === node.id)
      );

      // Start execution from the trigger nodes
      for (const triggerNode of triggerNodes) {
        get().executeNode(triggerNode.id);
      }
    } catch (error) {
      console.error("Error starting workflow:", error);
      set({ isWorkflowRunning: false });
    }
  },

  stopWorkflow: async () => {
    try {
      console.log("Stopping workflow...");

      // Handle clean-up for each node
      const { nodes, nodeResults } = get();

      // Stop any running trigger nodes

      // Stop telegram-receive nodes
      const telegramNodes = nodes.filter(
        (node) => node.data.type === "telegram-receive"
      );

      if (telegramNodes.length > 0) {
        console.log(
          `Stopping ${telegramNodes.length} Telegram nodes...`
        );

        for (const node of telegramNodes) {
          console.log(
            `Stopping Telegram node: ${node.data.label} (${node.id})`
          );

          if (nodeResults[node.id]?.stop) {
            try {
              await nodeResults[node.id].stop();
              console.log(
                `Successfully stopped Telegram node: ${node.id}`
              );
            } catch (error) {
              console.error(
                `Error stopping Telegram node ${node.id}:`,
                error
              );
            }
          } else {
            console.warn(
              `No stop method found for Telegram node: ${node.id}`
            );
          }
        }
      }

      // Stop crypto-price-trigger nodes
      const cryptoPriceNodes = nodes.filter(
        (node) => node.data.type === "crypto-price-trigger"
      );

      if (cryptoPriceNodes.length > 0) {
        console.log(
          `Stopping ${cryptoPriceNodes.length} Crypto Price nodes...`
        );

        for (const node of cryptoPriceNodes) {
          console.log(
            `Stopping Crypto Price node: ${node.data.label} (${node.id})`
          );

          if (nodeResults[node.id]?.stop) {
            try {
              await nodeResults[node.id].stop();
              console.log(
                `Successfully stopped Crypto Price node: ${node.id}`
              );
            } catch (error) {
              console.error(
                `Error stopping Crypto Price node ${node.id}:`,
                error
              );
            }
          } else {
            console.warn(
              `No stop method found for Crypto Price node: ${node.id}`
            );
          }
        }
      }

      // Stop APM version trigger nodes
      const apmVersionNodes = nodes.filter(
        (node) => node.data.type === "apm-version-trigger"
      );

      if (apmVersionNodes.length > 0) {
        console.log(
          `Stopping ${apmVersionNodes.length} APM Version nodes...`
        );

        for (const node of apmVersionNodes) {
          console.log(
            `Stopping APM Version node: ${node.data.label} (${node.id})`
          );

          if (nodeResults[node.id]?.stop) {
            try {
              await nodeResults[node.id].stop();
              console.log(
                `Successfully stopped APM Version node: ${node.id}`
              );
            } catch (error) {
              console.error(
                `Error stopping APM Version node ${node.id}:`,
                error
              );
            }
          } else {
            console.warn(
              `No stop method found for APM Version node: ${node.id}`
            );
          }
        }
      }

      // Clear all execution states and results
      console.log("Clearing workflow execution state...");
      set({
        isWorkflowRunning: false,
        nodeExecutionState: {},
        nodeResults: {},
      });

      console.log("Workflow stopped successfully");
    } catch (error) {
      console.error("Error stopping workflow:", error);
      set({ isWorkflowRunning: false });
    }
  },

  executeNode: async (nodeId, inputData) => {
    try {
      const { nodes, edges, nodeResults } = get();
      const node = nodes.find((n) => n.id === nodeId);

      if (!node) {
        throw new Error(`Node with id ${nodeId} not found`);
      }

      console.log(
        `Executing node '${node.data.label}' (${node.data.type}) with ID ${nodeId}`
      );

      // Update node state to running
      set((state) => ({
        nodeExecutionState: {
          ...state.nodeExecutionState,
          [nodeId]: "running",
        },
      }));

      // Execute the node based on its type
      let result: any = undefined;

      switch (node.data.type) {
        case "apm-version-trigger": {
          try {
            // Import dynamically to avoid circular dependencies
            const { nodeExecutors } = await import(
              "@/lib/utils/api-service"
            );

            // Start the APM version polling process
            console.log("Starting APM version polling process...");
            const versionHandler = await nodeExecutors.executeAPMVersionTrigger(
              node.data.config
            );

            // Store the handler in nodeResults (mainly for the stop method)
            set((state) => ({
              nodeResults: {
                ...state.nodeResults,
                [nodeId]: versionHandler,
              },
            }));

            // Keep node in running state while polling is active
            set((state) => ({
              nodeExecutionState: {
                ...state.nodeExecutionState,
                [nodeId]: "running",
              },
            }));

            console.log(
              "APM version node is now polling for package updates..."
            );

            // Start polling and set up callback for when a new version is detected
            versionHandler.startPolling(async (versionData: any) => {
              console.log('New version detected!', versionData);

              // Update node state to success
              set((state) => ({
                nodeExecutionState: {
                  ...state.nodeExecutionState,
                  [nodeId]: "success",
                },
              }));

              // Get outgoing edges from this node
              const outgoingEdges = edges.filter(
                (edge) => edge.source === nodeId
              );

              // Execute the next nodes with the version data
              for (const edge of outgoingEdges) {
                const targetNode = nodes.find(
                  (n) => n.id === edge.target
                );
                console.log(
                  `Passing version data to next node: ${targetNode?.data.label || edge.target}`
                );
                await get().executeNode(edge.target, versionData);
              }
            });

            // Add the check method to the node result
            set((state) => ({
              nodeResults: {
                ...state.nodeResults,
                [nodeId]: {
                  ...state.nodeResults[nodeId],
                  checkCurrentVersion: versionHandler.checkCurrentVersion
                }
              }
            }));

            result = [];  // No immediate results, the node will keep polling
          } catch (error) {
            console.error(`Error initializing APM Version node ${nodeId}:`, error);

            // Update node state to error
            set((state) => ({
              nodeExecutionState: {
                ...state.nodeExecutionState,
                [nodeId]: "error",
              },
            }));

            throw error;
          }
          break;
        }

        case "crypto-price-trigger": {
          try {
            // Import dynamically to avoid circular dependencies
            const { nodeExecutors } = await import(
              "@/lib/utils/api-service"
            );

            // Start the crypto price polling process
            console.log("Starting crypto price polling process...");
            const priceHandler = await nodeExecutors.executeCryptoPriceTrigger(
              node.data.config
            );

            // Store the handler in nodeResults (mainly for the stop method)
            set((state) => ({
              nodeResults: {
                ...state.nodeResults,
                [nodeId]: priceHandler,
              },
            }));

            // Keep node in running state while polling is active
            set((state) => ({
              nodeExecutionState: {
                ...state.nodeExecutionState,
                [nodeId]: "running",
              },
            }));

            console.log(
              "Crypto price node is now polling for price changes..."
            );

            // Start polling and set up callback for when price condition is met
            priceHandler.startPolling(async (priceData: any) => {
              console.log('Price condition triggered!', priceData);

              // Update node state to success
              set((state) => ({
                nodeExecutionState: {
                  ...state.nodeExecutionState,
                  [nodeId]: "success",
                },
              }));

              // Get outgoing edges from this node
              const outgoingEdges = edges.filter(
                (edge) => edge.source === nodeId
              );

              // Execute the next nodes with the price data
              for (const edge of outgoingEdges) {
                const targetNode = nodes.find(
                  (n) => n.id === edge.target
                );
                console.log(
                  `Passing price data to next node: ${targetNode?.data.label || edge.target}`
                );
                await get().executeNode(edge.target, priceData);
              }
            });

            // Add the check method to the node result
            set((state) => ({
              nodeResults: {
                ...state.nodeResults,
                [nodeId]: {
                  ...state.nodeResults[nodeId],
                  checkPrice: priceHandler.checkPrice
                }
              }
            }));

            result = [];  // No immediate results, the node will keep polling
          } catch (error) {
            console.error(`Error initializing Crypto Price node ${nodeId}:`, error);

            // Update node state to error
            set((state) => ({
              nodeExecutionState: {
                ...state.nodeExecutionState,
                [nodeId]: "error",
              },
            }));

            throw error;
          }
          break;
        }

        case "telegram-receive": {
          try {
            // Import dynamically to avoid circular dependencies
            const { nodeExecutors } = await import(
              "@/lib/utils/api-service"
            );

            // Start the Telegram receive process
            console.log("Starting Telegram receive process...");
            const telegramHandler =
              await nodeExecutors.executeTelegramReceive(
                node.data.config
              );

            // Store the handler in nodeResults (mainly for the stop method)
            set((state) => ({
              nodeResults: {
                ...state.nodeResults,
                [nodeId]: telegramHandler,
              },
            }));

            // Keep node in running state while the bot is active
            set((state) => ({
              nodeExecutionState: {
                ...state.nodeExecutionState,
                [nodeId]: "running",
              },
            }));

            console.log(
              "Telegram node is now waiting for changes in recent files..."
            );

            // Also add a method to manually check for recent files
            const checkRecentFiles = async () => {
              console.log(
                "Manually checking for recent files..."
              );
              if (get().isWorkflowRunning) {
                const recentFiles =
                  await telegramHandler.processRecentFiles();
                if (recentFiles.length > 0) {
                  console.log(
                    `Found new file, passing to connected nodes...`
                  );
                  // Show success state temporarily
                  set((state) => ({
                    nodeExecutionState: {
                      ...state.nodeExecutionState,
                      [nodeId]: "success",
                    },
                  }));

                  // Get outgoing edges from this node
                  const outgoingEdges = edges.filter(
                    (edge) => edge.source === nodeId
                  );
                  console.log(
                    `Found ${outgoingEdges.length} outgoing edges from Telegram node`
                  );

                  const latestFile = recentFiles[0]; // There will only be one file in the array if there's a change
                  console.log(`Processing latest file: ${latestFile.fileName || latestFile.id}`);

                  // Determine node types to pass different context to each node
                  const arweaveNodes: any[] = [];
                  const telegramNodes: any[] = [];

                  outgoingEdges.forEach(edge => {
                    const targetNode = nodes.find(n => n.id === edge.target);
                    if (targetNode) {
                      if (targetNode.data.type === 'arweave-upload') {
                        arweaveNodes.push(edge);
                      } else if (targetNode.data.type === 'telegram') {
                        telegramNodes.push(edge);
                      }
                    }
                  });

                  // Execute telegram nodes first with "parallel before" context
                  const telegramPromises = telegramNodes.map((edge: any) => {
                    const targetNode = nodes.find(n => n.id === edge.target);
                    console.log(`Sending "parallel before" message to Telegram node: ${targetNode?.data.label || edge.target}`);
                    return get().executeNode(edge.target, {
                      ...latestFile,
                      messageContext: 'before',
                      originalMessage: node.data.config.message || 'parallel before'
                    });
                  });

                  // Execute all Telegram nodes and wait for completion
                  if (telegramPromises.length > 0) {
                    console.log('Sending all Telegram messages first...');
                    await Promise.all(telegramPromises);
                    console.log('All Telegram messages sent successfully');
                  }

                  // Execute arweave nodes without waiting for them to complete
                  arweaveNodes.forEach((edge: any) => {
                    const targetNode = nodes.find(n => n.id === edge.target);
                    console.log(`Starting file upload to Arweave node (background): ${targetNode?.data.label || edge.target}`);
                    // Don't await here - let it run in the background
                    get().executeNode(edge.target, latestFile)
                      .then(() => console.log(`Arweave upload completed for node: ${targetNode?.data.label || edge.target}`))
                      .catch(err => console.error(`Error in background Arweave upload: ${err.message}`));
                  });

                  // After 2 seconds, go back to running state
                  setTimeout(() => {
                    if (get().isWorkflowRunning) {
                      set(state => ({
                        nodeExecutionState: {
                          ...state.nodeExecutionState,
                          [nodeId]: 'running'
                        }
                      }));
                    }
                  }, 2000);
                } else {
                  console.log('No new files found');
                }
              }
            };

            // Add the check method to the node result
            set((state) => ({
              nodeResults: {
                ...state.nodeResults,
                [nodeId]: {
                  ...state.nodeResults[nodeId],
                  checkRecentFiles
                }
              }
            }));

            // Start polling for new files and set up the callback
            console.log('Starting to poll for new files...');
            telegramHandler.startPolling(async (fileData: any) => {
              console.log('New file detected from Telegram:', fileData);

              // When a new file is detected, temporarily show success state
              set(state => ({
                nodeExecutionState: {
                  ...state.nodeExecutionState,
                  [nodeId]: 'success'
                }
              }));

              // Get outgoing edges and forward the latest file
              const outgoingEdges = get().edges.filter(edge => edge.source === nodeId);

              // Determine node types to pass different context to each node
              const arweaveNodes: any[] = [];
              const telegramNodes: any[] = [];

              outgoingEdges.forEach(edge => {
                const targetNode = get().nodes.find(n => n.id === edge.target);
                if (targetNode) {
                  if (targetNode.data.type === 'arweave-upload') {
                    arweaveNodes.push(edge);
                  } else if (targetNode.data.type === 'telegram') {
                    telegramNodes.push(edge);
                  }
                }
              });

              // Execute telegram nodes first with "parallel before" context
              const telegramPromises = telegramNodes.map((edge: any) => {
                const targetNode = get().nodes.find(n => n.id === edge.target);
                console.log(`Sending "parallel before" message to Telegram node: ${targetNode?.data.label || edge.target}`);
                return get().executeNode(edge.target, {
                  ...fileData,
                  messageContext: 'before',
                  originalMessage: node.data.config.message || 'parallel before'
                });
              });

              // Execute all Telegram nodes and wait for completion
              if (telegramPromises.length > 0) {
                console.log('Sending all Telegram messages first...');
                await Promise.all(telegramPromises);
                console.log('All Telegram messages sent successfully');
              }

              // Execute arweave nodes without waiting for them to complete
              arweaveNodes.forEach((edge: any) => {
                const targetNode = nodes.find(n => n.id === edge.target);
                console.log(`Starting file upload to Arweave node (background): ${targetNode?.data.label || edge.target}`);
                // Don't await here - let it run in the background
                get().executeNode(edge.target, fileData)
                  .then(() => console.log(`Arweave upload completed for node: ${targetNode?.data.label || edge.target}`))
                  .catch(err => console.error(`Error in background Arweave upload: ${err.message}`));
              });

              // After 2 seconds, go back to running state
              setTimeout(() => {
                if (get().isWorkflowRunning) {
                  set(state => ({
                    nodeExecutionState: {
                      ...state.nodeExecutionState,
                      [nodeId]: 'running'
                    }
                  }));
                }
              }, 2000);
            });

            result = [];  // No immediate results, the node will keep polling
          } catch (error) {
            console.error(`Error initializing Telegram receive node ${nodeId}:`, error);

            // Update node state to error
            set((state) => ({
              nodeExecutionState: {
                ...state.nodeExecutionState,
                [nodeId]: "error",
              },
            }));

            throw error;
          }
          break;
        }

        case "arweave-upload": {
          try {
            if (!inputData) {
              console.error(
                "No file data provided to Arweave upload node"
              );
              throw new Error("No file data provided to upload");
            }

            console.log(
              `Arweave upload node received input:`,
              inputData
            );

            // Import dynamically to avoid circular dependencies
            const { nodeExecutors } = await import(
              "@/lib/utils/api-service"
            );

            // Upload the file to Arweave
            console.log(`Uploading file to Arweave...`);
            const uploadResult =
              await nodeExecutors.executeArweaveUpload(
                node.data.config,
                inputData
              );
            console.log(`Upload successful:`, uploadResult);

            // Log the actual Arweave URL from the result
            if (uploadResult && uploadResult.arweave_url) {
              console.log(`Arweave URL generated: ${uploadResult.arweave_url}`);
            } else if (uploadResult && uploadResult.data && uploadResult.data.arweave_url) {
              console.log(`Arweave URL in data property: ${uploadResult.data.arweave_url}`);
            } else {
              console.warn(`No Arweave URL found in upload result:`, uploadResult);
            }

            // Store the result
            set((state) => ({
              nodeResults: {
                ...state.nodeResults,
                [nodeId]: uploadResult,
              },
              nodeExecutionState: {
                ...state.nodeExecutionState,
                [nodeId]: "success",
              },
            }));

            // Get outgoing edges from this node
            const outgoingEdges = edges.filter(
              (edge) => edge.source === nodeId
            );

            // Execute the next nodes with the upload result as input
            for (const edge of outgoingEdges) {
              const targetNode = nodes.find(
                (n) => n.id === edge.target
              );
              console.log(
                `Passing Arweave result to node: ${targetNode?.data.label || edge.target}`
              );

              // Check if the target node is a Telegram node
              if (targetNode?.data.type === 'telegram') {
                console.log('Target is a Telegram node, appending arweave_url to inputData');

                // Create the input data for Telegram with the Arweave URL
                const arweaveUrl = uploadResult.arweave_url ||
                  (uploadResult.data && uploadResult.data.arweave_url);

                if (!arweaveUrl) {
                  console.warn('No Arweave URL found to pass to Telegram node!');
                }

                // Pass the original inputData plus the arweave_url to the Telegram node
                const telegramInputData = {
                  ...(inputData || {}),
                  arweave_url: arweaveUrl,
                  arweaveUrl: arweaveUrl, // Also add with camelCase for convenience
                  upload_result: uploadResult, // Include the full result for flexibility
                  isFromArweaveNode: true, // Add flag to indicate this data is coming directly from an Arweave node
                };

                console.log('Telegram input data prepared:', telegramInputData);

                await get().executeNode(edge.target, telegramInputData);
              } else {
                // For other node types, just pass the upload result as is
                await get().executeNode(edge.target, uploadResult);
              }
            }

            result = uploadResult;
          } catch (error) {
            console.error(`Error in Arweave upload node:`, error);

            // Update node state to error
            set((state) => ({
              nodeExecutionState: {
                ...state.nodeExecutionState,
                [nodeId]: "error",
              },
            }));

            throw error;
          }
          break;
        }

        case "telegram": {
          try {
            console.log(`Executing Telegram send node (${nodeId})`);
            console.log(`Input data for Telegram node:`, inputData);

            // Check if we have Arweave URL in the input data
            if (inputData && (inputData.arweave_url || inputData.arweaveUrl)) {
              console.log(`Detected Arweave URL in input: ${inputData.arweave_url || inputData.arweaveUrl}`);
            } else if (inputData && inputData.upload_result && inputData.upload_result.arweave_url) {
              console.log(`Detected Arweave URL in upload_result: ${inputData.upload_result.arweave_url}`);
            } else {
              console.log(`No Arweave URL detected in input data`);
            }

            // Import dynamically to avoid circular dependencies
            const { nodeExecutors } = await import(
              "@/lib/utils/api-service"
            );

            // Updated message - no need to warn about missing template
            // since we'll automatically append the URL if available
            if (node.data.config.message && node.data.config.message.includes('{arweave_url}')) {
              console.log(`Message contains {arweave_url} template: "${node.data.config.message}"`);
              console.log(`URL will be inserted at template position`);
            } else if (inputData && inputData.isFromArweaveNode && (inputData.arweave_url || inputData.arweaveUrl ||
              (inputData.upload_result && inputData.upload_result.arweave_url))) {
              console.log(`Message does not contain {arweave_url} template but data is from Arweave node`);
              console.log(`URL will be automatically appended to the message`);
            } else if (inputData && !inputData.isFromArweaveNode && (inputData.arweave_url || inputData.arweaveUrl ||
              (inputData.upload_result && inputData.upload_result.arweave_url))) {
              console.log(`Message does not contain {arweave_url} template and data is not from Arweave node`);
              console.log(`URL will NOT be automatically appended. Use {arweave_url} in your message template to include it.`);
            }

            // Execute the Telegram send operation
            console.log(
              `Sending Telegram message with config:`,
              node.data.config
            );
            const sendResult =
              await nodeExecutors.executeTelegramSend(
                node.data.config,
                inputData
              );
            console.log(`Message sent successfully:`, sendResult);

            // Store the result
            set((state) => ({
              nodeResults: {
                ...state.nodeResults,
                [nodeId]: sendResult,
              },
              nodeExecutionState: {
                ...state.nodeExecutionState,
                [nodeId]: "success",
              },
            }));

            // Get outgoing edges from this node
            const outgoingEdges = edges.filter(
              (edge) => edge.source === nodeId
            );

            // Execute the next nodes with the send result as input
            for (const edge of outgoingEdges) {
              const targetNode = nodes.find(
                (n) => n.id === edge.target
              );
              console.log(
                `Passing Telegram send result to node: ${targetNode?.data.label || edge.target}`
              );
              await get().executeNode(edge.target, sendResult);
            }

            result = sendResult;
          } catch (error) {
            console.error(`Error in Telegram send node:`, error);

            // Update node state to error
            set((state) => ({
              nodeExecutionState: {
                ...state.nodeExecutionState,
                [nodeId]: "error",
              },
            }));

            throw error;
          }
          break;
        }

        default: {
          console.error(`Unknown node type: ${node.data.type}`);
          throw new Error(`Unknown node type: ${node.data.type}`);
        }
      }

      return result;
    } catch (error) {
      console.error(`Error executing node ${nodeId}:`, error);
      set((state) => ({
        nodeExecutionState: {
          ...state.nodeExecutionState,
          [nodeId]: "error",
        },
      }));
      throw error;
    }
  },

  // Save/Load
  saveWorkflow: () => {
    // Implementation needed
  },
  loadWorkflow: () => {
    // Implementation needed
  },
}));