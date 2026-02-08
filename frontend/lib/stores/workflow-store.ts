import { create } from "zustand";
import { nanoid } from "nanoid";
import {
  applyNodeChanges,
  applyEdgeChanges,
  Node as ReactFlowNode,
  Edge as ReactFlowEdge,
  NodeChange as ReactFlowNodeChange,
  EdgeChange as ReactFlowEdgeChange,
  XYPosition,
  Position,
} from "@reactflow/core";
import "@reactflow/core/dist/style.css";

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

  setNodes: (nodes: Node<NodeData>[]) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  addNode: (nodeType: string, position: XYPosition) => void;
  updateNodeData: (nodeId: string, data: Partial<NodeData>) => void;
  duplicateNode: (nodeId: string) => void;
  deleteNode: (nodeId: string) => void;

  setEdges: (edges: Edge[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  addEdge: (params: {
    source: string;
    sourceHandle: string | null;
    target: string;
    targetHandle: string | null;
  }) => void;
  deleteEdge: (edgeId: string) => void;

  setSelectedNode: (node: Node<NodeData> | null) => void;
  setSelectedEdge: (edge: Edge | null) => void;

  startWorkflow: () => Promise<void>;
  stopWorkflow: () => Promise<void>;
  executeNode: (nodeId: string, inputData?: any) => Promise<any>;

  saveWorkflow: () => void;
  loadWorkflow: () => void;
};

export const NODE_TYPES = {
  trigger: {
    category: "Triggers",
    items: [
      {
        type: "telegram-trigger",
        label: "Telegram",
        icon: "messageCircle",
        description: "Enter your Telegram chat ID and hit Run to receive auth message and start workflow",
        config: {
          chatId: "",
          messageTypes: "all",
        },
      },
      {
        type: "discord-trigger",
        label: "Discord",
        icon: "hash",
        description: "Trigger on Discord channel messages",
        config: {
          serverId: "",
          channelId: "",
          eventType: "message",
        },
      },
      {
        type: "whatsapp-trigger",
        label: "WhatsApp",
        icon: "phone",
        description: "Trigger on incoming WhatsApp messages",
        config: {
          provider: "twilio",
          phoneNumberId: "",
        },
      },
    ],
  },

  action: {
    category: "Actions",
    items: [
      {
        type: "stellar-sdk",
        label: "Stellar SDK (Chatbot)",
        icon: "send",
        description: "Chatbot mode: User asks Stellar questions in Telegram, bot answers using SDK",
        config: {
          network: "testnet",
          operation: "chatbot",
          destination: "",
        },
      },
      {
        type: "wallet-integration",
        label: "Wallet Integration",
        icon: "wallet",
        description: "Connect to Freighter browser wallet or create a Telegram-native wallet",
        config: {
          walletProvider: "freighter",
          network: "testnet",
        },
      },
      {
        type: "telegram-send",
        label: "Send Telegram",
        icon: "messageCircle",
        description: "Send a message to Telegram. Use {balance}, {address} for templates.",
        config: {
          chatId: "",
          message: "",
        },
      },
      {
        type: "anchor-onramp",
        label: "Anchor On-Ramp",
        icon: "arrowDown",
        description: "Convert fiat to Stellar assets via anchor",
        config: {
          anchorUrl: "",
          fiatCurrency: "USD",
          asset: "USDC",
          amount: "",
        },
      },
      {
        type: "anchor-offramp",
        label: "Anchor Off-Ramp",
        icon: "arrowUp",
        description: "Convert Stellar assets to fiat via anchor",
        config: {
          anchorUrl: "",
          asset: "USDC",
          fiatCurrency: "USD",
          amount: "",
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
        description: "Add a delay in workflow execution",
        config: { delay: 5 },
      },
    ],
  },
};

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
    set((state) => {
      const node = state.nodes.find((n) => n.id === nodeId);
      if (!node) return state;

      let updatedData = { ...data };
      if (data.config) {
        updatedData.config = {
          ...node.data.config,
          ...data.config,
        };
      }

      const updatedNodes = state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, ...updatedData } }
          : n
      );

      return {
        nodes: updatedNodes,
        selectedNode:
          state.selectedNode?.id === nodeId
            ? updatedNodes.find((n) => n.id === nodeId) || state.selectedNode
            : state.selectedNode,
      };
    });
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
      const newEdges = state.edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId
      );
      return {
        nodes: state.nodes.filter((node) => node.id !== nodeId),
        edges: newEdges,
        selectedNode:
          state.selectedNode?.id === nodeId ? null : state.selectedNode,
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

  startWorkflow: async () => {
    try {
      set({
        isWorkflowRunning: true,
        nodeExecutionState: {},
        nodeResults: {},
      });

      const { nodes, edges } = get();
      const triggerNodes = nodes.filter(
        (node) => !edges.some((edge) => edge.target === node.id)
      );

      for (const triggerNode of triggerNodes) {
        get().executeNode(triggerNode.id);
      }
    } catch (error) {
      console.error("Error starting workflow:", error);
      set({ isWorkflowRunning: false });
    }
  },

  stopWorkflow: async () => {
    set({
      isWorkflowRunning: false,
      nodeExecutionState: {},
      nodeResults: {},
    });
  },

  executeNode: async (nodeId, inputData) => {
    try {
      const { nodes, edges } = get();
      const node = nodes.find((n) => n.id === nodeId);

      if (!node) {
        throw new Error(`Node with id ${nodeId} not found`);
      }

      set((state) => ({
        nodeExecutionState: {
          ...state.nodeExecutionState,
          [nodeId]: "running",
        },
      }));

      let result: any = undefined;
      const { nodeExecutors } = await import("@/lib/utils/api-service");

      switch (node.data.type) {
        case "telegram-trigger": {
          // Find all nodes connected to this telegram trigger
          const connectedNodeIds = edges
            .filter((e) => e.source === nodeId)
            .map((e) => e.target);
          const connectedNodes = nodes.filter((n) => connectedNodeIds.includes(n.id));
          const connectedNodeTypes = connectedNodes.map((n) => n.data.type);

          const connectResult = await nodeExecutors.executeTelegramConnect(
            node.data.config,
            connectedNodeTypes
          );

          set((state) => ({
            nodeResults: { ...state.nodeResults, [nodeId]: connectResult },
            nodeExecutionState: {
              ...state.nodeExecutionState,
              [nodeId]: "success",
            },
          }));

          const chatId = node.data.config.chatId || connectResult.chatId;
          const payload = { ...connectResult, chatId };

          // Only execute connected nodes if there are any
          if (connectedNodeIds.length > 0) {
            for (const edge of edges.filter((e) => e.source === nodeId)) {
              await get().executeNode(edge.target, payload);
            }
          }

          result = payload;
          break;
        }

        case "stellar-sdk": {
          const stellarResult = await nodeExecutors.executeStellarSDK(
            node.data.config,
            { ...inputData, chatId: inputData?.chatId }
          );

          set((state) => ({
            nodeResults: { ...state.nodeResults, [nodeId]: stellarResult },
            nodeExecutionState: {
              ...state.nodeExecutionState,
              [nodeId]: "success",
            },
          }));

          const payload = {
            ...stellarResult,
            chatId: inputData?.chatId,
            mode: "chatbot",
          };

          for (const edge of edges.filter((e) => e.source === nodeId)) {
            await get().executeNode(edge.target, payload);
          }

          result = payload;
          break;
        }

        case "wallet-integration": {
          const walletResult = await nodeExecutors.executeWalletIntegration(
            node.data.config,
            inputData
          );

          set((state) => ({
            nodeResults: { ...state.nodeResults, [nodeId]: walletResult },
            nodeExecutionState: {
              ...state.nodeExecutionState,
              [nodeId]: "success",
            },
          }));

          for (const edge of edges.filter((e) => e.source === nodeId)) {
            await get().executeNode(edge.target, { ...inputData, ...walletResult });
          }

          result = walletResult;
          break;
        }

        case "telegram-send": {
          const config = {
            ...node.data.config,
            chatId: node.data.config.chatId || inputData?.chatId,
          };

          const sendResult = await nodeExecutors.executeTelegramSend(
            config,
            inputData
          );

          set((state) => ({
            nodeResults: { ...state.nodeResults, [nodeId]: sendResult },
            nodeExecutionState: {
              ...state.nodeExecutionState,
              [nodeId]: "success",
            },
          }));

          for (const edge of edges.filter((e) => e.source === nodeId)) {
            await get().executeNode(edge.target, { ...inputData, ...sendResult });
          }

          result = sendResult;
          break;
        }

        case "delay": {
          const delay = parseInt(node.data.config?.delay || "5", 10) * 1000;
          await new Promise((r) => setTimeout(r, delay));
          set((state) => ({
            nodeExecutionState: {
              ...state.nodeExecutionState,
              [nodeId]: "success",
            },
          }));
          result = { delayed: delay };
          for (const edge of edges.filter((e) => e.source === nodeId)) {
            await get().executeNode(edge.target, { ...inputData, delayed: delay });
          }
          break;
        }

        default: {
          if (
            ["discord-trigger", "whatsapp-trigger", "anchor-onramp", "anchor-offramp"].includes(
              node.data.type
            )
          ) {
            set((state) => ({
              nodeExecutionState: {
                ...state.nodeExecutionState,
                [nodeId]: "error",
              },
            }));
            throw new Error(`Node type "${node.data.type}" not yet implemented`);
          }
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

  saveWorkflow: () => {},
  loadWorkflow: () => {},
}));
