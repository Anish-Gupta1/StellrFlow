# StellrFlow

<div align="center">
  <img src="./frontend/public/logo.png" alt="StellrFlow Logo" width="200"/>
  
  **Visual Workflow Automation for the Stellar Blockchain**
  
  [![Stellar](https://img.shields.io/badge/Stellar-Network-brightgreen)](https://stellar.org/)
  [![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
  [![Soroban](https://img.shields.io/badge/Soroban-Smart_Contracts-orange)](https://soroban.stellar.org/)
</div>

---
 
## 📖 Table of Contents

- [About](#about)
- [Problem Statement](#problem-statement)
- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Future Scope](#future-scope)
- [Contributing](#contributing)
- [License](#license)

---

## 🌟 About

**StellrFlow** is a visual workflow automation platform built on the Stellar blockchain that empowers users to create sophisticated blockchain interactions without writing a single line of code. Through an intuitive drag-and-drop interface, users can connect triggers, actions, and conditions to automate Stellar transactions, monitor balances, send notifications, and integrate with popular messaging platforms. 

Whether you're a DeFi enthusiast wanting to automate trading strategies, a project manager needing to track wallet balances, or a developer building blockchain-powered notification systems, StellrFlow makes it simple and accessible for everyone.

---

## 🎯 Problem Statement

### The Challenge

Blockchain development, particularly on Stellar, presents significant barriers to entry:

1. **Technical Complexity**: Interacting with blockchain networks requires understanding SDKs, APIs, transaction signing, and smart contracts
2. **Integration Friction**: Building integrations between blockchain operations and external services (Telegram, Discord, payment systems) requires significant development effort
3. **Lack of No-Code Solutions**: Most blockchain automation requires hiring developers or learning to code
4. **Limited Accessibility**: Non-technical users are locked out of powerful blockchain automation capabilities
5. **Time-Consuming Development**: Even simple automation tasks can take hours or days to implement

### Our Solution

StellrFlow solves these problems by providing:

- **Visual Workflow Builder**: Intuitive drag-and-drop interface powered by ReactFlow
- **Pre-built Nodes**: Ready-to-use components for common Stellar operations
- **Messaging Integration**: Native support for Telegram with extensibility for Discord and WhatsApp
- **Real-time Execution**: Live workflow execution with visual feedback and error handling
- **Wallet Integration**: Seamless connection with Freighter wallet for secure transaction signing

**Result**: What previously took days of development can now be accomplished in minutes with zero coding required.

---

## ✨ Features

### 🎨 Visual Workflow Builder
- **Drag-and-Drop Interface**: Intuitive node-based workflow creation using ReactFlow
- **Real-time Preview**: See your workflow structure as you build it
- **Node Categories**: Organized triggers, actions, conditions, and utilities
- **Connection Validation**: Smart validation prevents invalid workflow connections
- **Save & Load**: Persist workflows to local storage for later use

### 🔗 Stellar Blockchain Integration
- **Balance Monitoring**: Check XLM and token balances for any Stellar address
- **Transaction Sending**: Send XLM payments with configurable amounts and destinations
- **Account Monitoring**: Track account activities and trigger workflows on changes
- **Freighter Wallet**: Native integration with Stellar's popular browser wallet
- **Horizon API**: Direct integration with Stellar's Horizon API for real-time data

💬 **Telegram Bot Integration**

**Bot Creation via BotFather**  
Users create their own Telegram bot using **@BotFather**, Telegram’s official bot management tool.  
By running `/start` → `/newbot`, users choose a bot name and username and receive a **Bot Token**, which StellrFlow uses to connect the workflow to Telegram.

**Bot Token Usage**  
The **Bot Token** is used by StellrFlow to:  
- Send messages to users  
- Listen for commands  
- Trigger workflows from incoming messages  

Tokens can be revoked or regenerated at any time using **BotFather**.

**Chat ID Retrieval**  
After creating the bot, the user sends a `/start` message to their bot.  
StellrFlow captures the **Chat ID** from the incoming Telegram update and uses it to bind workflows to that specific chat.

**Command-Based Interface**  
The bot supports simple and intuitive commands such as:  
- `/start` – Initialize interaction with the bot  
- `/balance` – Check Stellar wallet balance  
- `/help` – View available commands  
- `/send <address> <amount>` – Send XLM  

**Message Notifications**  
Workflows can send automated Telegram notifications for:  
- Wallet balance updates  
- Transaction confirmations  
- Errors or workflow status updates  

**Two-Way Communication**  
Telegram acts as both:  
- A **trigger** (user messages start workflows)  
- A **response channel** (bot sends messages and confirmations)  

**AI-Powered Responses**  
When the AI chatbot block is enabled, the bot responds intelligently to user queries related to Stellar, wallets, and blockchain concepts using **OpenAI**.


### 🔧 Developer-Friendly
- **TypeScript**: Fully typed codebase for better developer experience
- **Modern Stack**: Next.js 15, React 19, Tailwind CSS
- **Component Library**: shadcn/ui for consistent, beautiful UI components
- **API Endpoints**: RESTful APIs for external integrations
- **Extensible Architecture**: Easy to add new node types and integrations

---

## 🏛️ Architecture Overview

StellrFlow follows a modular, three-tier architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend Layer                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Next.js    │  │  ReactFlow   │  │  Zustand     │      │
│  │   UI/UX      │  │  Workflow    │  │  State Mgmt  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                   │                   │            │
│         └───────────────────┴───────────────────┘            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Integration Layer                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Telegram    │  │  Freighter   │  │   Stellar    │      │
│  │     Bot      │  │   Wallet     │  │   Horizon    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                   │                   │            │
│         └───────────────────┴───────────────────┘            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Blockchain Layer                       │
│               ┌──────────────┐ ┌──────────────┐             │
│               │   Stellar    │ │   Horizon    │             │
│               │   Network    │ │     API      │             │
│               └──────────────┘ └──────────────┘             │
└─────────────────────────────────────────────────────────────┘
```

### Component Breakdown

#### 1. **Frontend (Next.js + ReactFlow)**
- **Workflow Builder**: Visual canvas for creating and editing workflows
- **Node Types Sidebar**: Categorized library of available workflow nodes
- **Properties Panel**: Configuration interface for selected nodes
- **Wallet Connection**: Freighter wallet integration for signing transactions
- **State Management**: Zustand store for workflow state and execution

#### 2. **Telegram Bot (Node.js + Express)**
- **Bot Commands**: Interactive command interface for users
- **Webhook Server**: Express API for receiving workflow notifications
- **Stellar SDK**: Integration with Stellar for balance checks and transactions
- **OpenAI Integration**: AI-powered responses and assistance


### Data Flow

1. **Workflow Creation**: User drags nodes onto canvas and connects them
2. **Configuration**: User configures each node with required parameters
3. **Execution**: User clicks "Run" to start workflow
4. **Node Processing**: Each node executes sequentially based on connections
5. **Stellar Operations**: Transactions are signed via Freighter wallet
6. **External Actions**: Telegram notifications sent via bot API
7. **Result Display**: Success/error states shown visually on nodes

---

## 🛠️ Tech Stack

### Frontend
- **Framework**: [Next.js 15](https://nextjs.org/) - React framework with App Router
- **UI Library**: [React 19](https://react.dev/) - Latest React with concurrent features
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework
- **Components**: [shadcn/ui](https://ui.shadcn.com/) - High-quality React components
- **Workflow Engine**: [ReactFlow](https://reactflowdev.com/) - Node-based UI builder
- **State Management**: [Zustand](https://zustand-demo.pmnd.rs/) - Lightweight state management
- **Drag & Drop**: [@dnd-kit](https://dndkit.com/) - Modern drag-and-drop toolkit

### Backend (Telegram Bot)
- **Runtime**: [Node.js](https://nodejs.org/) - JavaScript runtime
- **Framework**: [Express.js](https://expressjs.com/) - Web framework
- **Language**: [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript
- **Telegram**: [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) - Telegram Bot API
- **AI**: [OpenAI](https://openai.com/) - GPT integration for intelligent responses

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+ and npm/pnpm
- **Telegram Bot Token** (from [@BotFather](https://t.me/BotFather))
- **Freighter Wallet** ([Install](https://www.freighter.app/))
- **Stellar CLI** (optional, for smart contract deployment)

### Installation

#### 1. Clone the Repository

```bash
git clone https://github.com/Anish-Gupta1/StellrFlow.git
cd StellrFlow
```

#### 2. Setup Frontend

```bash
cd frontend
npm install
# or
pnpm install

# Create .env.local (optional)
echo "NEXT_PUBLIC_TELEGRAM_BOT_API=http://localhost:3003" > .env.local

# Start development server
npm run dev
# Frontend runs on http://localhost:3000
```

#### 3. Setup Telegram Bot

```bash
cd ../bots/telegram-stellar
npm install

# Create .env file
cat > .env << EOF
TELEGRAM_BOT_TOKEN=your_bot_token_here
PORT=3003
OPENAI_API_KEY=your_openai_key_here (optional)
EOF

# Start bot server
npm run dev
# Bot API runs on http://localhost:3003
```

#### 4. Get Your Telegram Chat ID

1. Start a chat with your bot on Telegram
2. Send `/register` command
3. Bot replies with your chat ID
4. Use this chat ID in your workflows

#### 5. Deploy Smart Contract (Optional)

```bash
cd ../../contracts/stellrflow_telegram_bot

# Build contract
stellar contract build

# Deploy to testnet
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellrflow_telegram_bot.wasm \
  --source alice \
  --network testnet

# Save the contract ID for later use
```

### Quick Start Example

1. Open http://localhost:3000 in your browser
2. Drag a "Telegram Trigger" node onto the canvas
3. Connect your Freighter wallet
5. Add a "Check Balance" node
6. Add a "Send Telegram Message" node
7. Connect them: Trigger → Balance → Message
8. Configure each node with your parameters
9. Click "Run Workflow" and watch it execute!

---

## 📁 Project Structure

```
StellrFlow/
├── frontend/                    # Next.js frontend application
│   ├── app/                    # App router pages
│   │   ├── page.tsx           # Main workflow builder page
│   │   ├── connect-wallet/    # Wallet connection page
│   │   └── send-transaction/  # Transaction demo page
│   ├── components/            # React components
│   │   ├── workflow/         # Workflow builder components
│   │   │   ├── workflow-builder.tsx
│   │   │   ├── node-types-sidebar.tsx
│   │   │   ├── properties-panel.tsx
│   │   │   └── nodes/        # Custom node implementations
│   │   ├── ui/              # shadcn/ui components
│   │   └── nav-bar.tsx      # Navigation bar
│   ├── lib/                 # Utilities and stores
│   │   ├── stores/         # Zustand state management
│   │   │   └── workflow-store.ts
│   │   └── utils/          # Helper functions
│   │       ├── api-service.ts
│   │       └── icons.tsx
│   └── types/              # TypeScript type definitions
│
├── bots/                    # Bot integrations
    └── telegram-stellar/   # Telegram bot with Stellar
        ├── src/
        │   ├── telegram-bot.ts      # Main bot server
        │   ├── sdk-chatbot.ts       # AI chatbot logic
        │   └── interval-parser.ts   # Utility functions
        ├── package.json
        └── README.md
```

---

## 🔮 Future Scope

StellrFlow has an ambitious roadmap to become the go-to automation platform for the Stellar ecosystem:

### 🔗 Additional Messaging Platforms
- **Discord Integration**: Full Discord bot with channel monitoring, message sending, and role-based triggers
- **WhatsApp Business API**: Enterprise-grade WhatsApp automation for business workflows
- **Slack Integration**: Team collaboration workflows with Slack notifications and commands
- **Email Notifications**: SMTP/SendGrid integration for email-based workflows

### 💱 DeFi & Trading Features
- **Token Swaps**: Visual interface for automated token swaps on Stellar DEX
  - Price-based triggers (buy when price < X, sell when price > Y)
  - Time-based trading strategies
  - Portfolio rebalancing automation
- **Liquidity Pool Management**: Automated liquidity provision and withdrawal
- **Yield Farming**: Auto-compound farming rewards
- **Arbitrage Bots**: Multi-DEX price comparison and automated arbitrage

### 🏗️ Advanced Stellar Protocol Features
- **Path Payments**: Multi-hop payment routing with automatic path finding
- **Claimable Balances**: Create and manage claimable balance workflows
- **Sponsored Reserves**: Sponsor transaction fees for other accounts
- **Multi-signature Support**: Complex multi-sig transaction workflows
- **Asset Management**: Token issuance, trustline management, and asset controls
- **Stellar Anchors**: Integration with fiat on/off ramps and anchor services

### 🤖 Smart Contract Expansion
- **DeFi Protocol Nodes**: Pre-built nodes for popular Stellar DeFi protocols
  - Aquarius integration
  - SoroswapFinance support
  - Blend Protocol lending/borrowing
- **Custom Contract Calls**: Generic interface for calling any Soroban contract
- **Contract Event Monitoring**: Trigger workflows on smart contract events
- **NFT Operations**: Mint, transfer, and manage Stellar NFTs

### 📊 Analytics & Monitoring
- **Workflow Analytics Dashboard**: Track execution history, success rates, and performance
- **Gas Optimization**: Automatic transaction batching and fee optimization
- **Alert System**: Push notifications for workflow failures or critical events
- **Performance Metrics**: Detailed insights into workflow execution times

### 🔐 Enterprise Features
- **Team Collaboration**: Share workflows within organizations
- **Role-Based Access Control**: Granular permissions for workflow management
- **Audit Logging**: Complete audit trail of all workflow executions
- **Private Node Hosting**: Self-hosted option for enterprise customers
- **API Access**: RESTful API for programmatic workflow management

### 🌐 Cross-Chain Capabilities
- **Bridge Integration**: Cross-chain transfers to/from Ethereum, BSC, Polygon
- **Multi-chain Monitoring**: Track assets across multiple blockchains
- **Unified Dashboard**: Single interface for all blockchain operations

### 📱 Mobile Experience
- **Progressive Web App**: Mobile-responsive workflow builder
- **Mobile Notifications**: Push notifications for workflow events
- **Mobile Wallet Support**: Integration with mobile Stellar wallets

### 🎓 Community & Education
- **Template Marketplace**: Share and discover pre-built workflow templates
- **Video Tutorials**: Comprehensive guides for common use cases
- **Community Forum**: Discussion board for users to share ideas
- **Workflow Import/Export**: Share workflows as JSON files

---

## 🤝 Contributing

We welcome contributions from the community! Whether it's bug fixes, new features, documentation improvements, or workflow templates, your input helps make StellrFlow better for everyone.

### How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow TypeScript best practices
- Write meaningful commit messages
- Add tests for new features
- Update documentation as needed
- Ensure code passes linting (`npm run lint`)

---

<div align="center">
  <strong>Built with ❤️ for the Stellar community</strong>
  <br/>
  <sub>Making blockchain automation accessible to everyone</sub>
</div>
