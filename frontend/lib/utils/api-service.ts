// API service for interacting with the backend services

const API_BASE_URL = "https://api-flowweave.vesala.xyz/api";

// Track if the bot is active across the application
let isBotActive = false;

// Store callback for file processing
let onNewFileProcessed: ((fileData: any) => void) | null = null;

// Track the last processed file ID to detect changes
let lastProcessedFileId: string | null = null;

// Arweave Package Manager (APM) API
export const apmApi = {
    // Query for APM package publications using GraphQL
    queryPackagePublications: async (packageName: string): Promise<{ success: boolean; publications?: any[]; latestVersion?: string; error?: string }> => {
        try {
            console.log(`Querying publications for APM package: ${packageName}...`);

            const graphqlEndpoint = 'https://arnode.asia/graphql';
            const query = {
                query: `
                    query {
                        transactions(
                            tags: [
                                { name: "Action", values: ["APM.Publish"] }
                                { name: "Name", values: ["${packageName}"] }
                            ]
                        ) {
                            edges {
                                node {
                                    id
                                    tags {
                                        name
                                        value
                                    }
                                }
                            }
                        }
                    }
                `
            };

            const response = await fetch(graphqlEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify(query)
            });

            if (!response.ok) {
                throw new Error(`GraphQL request failed with status: ${response.status}`);
            }

            const data = await response.json();

            // Extract publications from the response
            const publications = data.data?.transactions?.edges?.map((edge: any) => {
                const node = edge.node;
                const tags = node.tags.reduce((acc: Record<string, string>, tag: any) => {
                    acc[tag.name] = tag.value;
                    return acc;
                }, {});

                return {
                    id: node.id,
                    version: tags.Version || 'unknown',
                    name: tags.Name,
                    timestamp: new Date().toISOString(), // GraphQL doesn't directly return timestamp
                    tags
                };
            }) || [];

            // Sort by transaction ID to get the latest version first
            // (This assumes newer transactions have higher/newer IDs)
            publications.sort((a: any, b: any) => {
                if (a.id > b.id) return -1;
                if (a.id < b.id) return 1;
                return 0;
            });

            console.log(`Found ${publications.length} publications for ${packageName}`);

            // Get the latest version if any publications exist
            const latestVersion = publications.length > 0 ? publications[0].version : undefined;

            if (latestVersion) {
                console.log(`Latest version of ${packageName}: ${latestVersion}`);
            }

            return {
                success: true,
                publications,
                latestVersion
            };
        } catch (error) {
            console.error(`Error querying APM package publications:`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
};

// Cryptocurrency API
export const cryptocurrencyApi = {
    // Fetch price for a specific token (Arweave or AO)
    fetchPrice: async (token: string): Promise<{ success: boolean; price?: number; error?: string }> => {
        try {
            console.log(`Fetching price for ${token}...`);

            // Validate token type
            if (token.toLowerCase() !== 'arweave' && token.toLowerCase() !== 'ao') {
                return {
                    success: false,
                    error: `Invalid token type: ${token}. Supported tokens are: arweave, ao`
                };
            }

            // Build the URL based on the token type
            const endpoint = token.toLowerCase() === 'arweave'
                ? `${API_BASE_URL}/token-price/arweave`
                : `${API_BASE_URL}/token-price/ao`;

            console.log(`Requesting price from: ${endpoint}`);

            // Make the API request
            const response = await fetch(endpoint);

            if (!response.ok) {
                throw new Error(`API request failed with status: ${response.status}`);
            }

            const data = await response.json();

            // Extract price from the response (adjust this based on actual API response format)
            let price: number;

            if (token.toLowerCase() === 'arweave') {
                // Handle Arweave price response format
                if (!data.price && data.price !== 0) {
                    throw new Error('Price not found in Arweave API response');
                }
                price = parseFloat(data.price);
            } else {
                // Handle AO price response format
                if (!data.price && data.price !== 0) {
                    throw new Error('Price not found in AO API response');
                }
                price = parseFloat(data.price);
            }

            console.log(`Current ${token} price: $${price.toFixed(2)}`);

            return {
                success: true,
                price: price
            };
        } catch (error) {
            console.error(`Error fetching ${token} price:`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
};

// Telegram Bot API
export const telegramApi = {
    // Initialize the Telegram bot
    initialize: async () => {
        console.log("Initializing Telegram bot...");
        const response = await fetch(`${API_BASE_URL}/telegram/initialize`, {
            method: "POST",
        });
        return response.json();
    },

    // Start the Telegram bot
    start: async () => {
        console.log("Starting Telegram bot...");
        const response = await fetch(`${API_BASE_URL}/telegram/start`, {
            method: "POST",
        });
        if (response.ok) {
            isBotActive = true;
        }
        return response.json();
    },

    // Stop the Telegram bot
    stop: async () => {
        console.log("Stopping Telegram bot...");
        isBotActive = false;
        onNewFileProcessed = null; // Clear callback
        const response = await fetch(`${API_BASE_URL}/telegram/stop`, {
            method: "POST",
        });
        return response.json();
    },

    // Register a callback for new file processing
    registerFileProcessedCallback: (callback: (fileData: any) => void) => {
        onNewFileProcessed = callback;
    },

    // Get bot status
    getStatus: async () => {
        const response = await fetch(`${API_BASE_URL}/telegram/status`);
        const data = await response.json();
        if (data.success) {
            isBotActive = data.status.active;
        }
        return data;
    },

    // Get pending messages
    getPendingMessages: async () => {
        const response = await fetch(
            `${API_BASE_URL}/telegram/messages/pending`
        );
        return response.json();
    },

    // Get recent files
    getRecentFiles: async () => {
        console.log("Fetching recent files from Telegram...");
        const response = await fetch(`${API_BASE_URL}/telegram/files/recent`);
        const data = await response.json();

        let hasNewFiles = false;
        let latestFileId = null;

        if (data.success && data.files && data.files.length > 0) {
            // Sort files by ID or timestamp to ensure newest is first
            const sortedFiles = [...data.files].sort(
                (a, b) => parseInt(b.id) - parseInt(a.id)
            );

            latestFileId = sortedFiles[0].id;

            // Check if we have a new file (different from the last processed)
            if (latestFileId !== lastProcessedFileId) {
                hasNewFiles = true;
                lastProcessedFileId = latestFileId;
            }
        }

        return {
            ...data,
            hasNewFiles,
            latestFileId,
        };
    },

    // Process a specific message
    processMessage: async (messageId: string) => {
        const response = await fetch(
            `${API_BASE_URL}/telegram/messages/${messageId}/process`,
            {
                method: "POST",
            }
        );
        return response.json();
    },

    // Get all files
    getFiles: async () => {
        const response = await fetch(`${API_BASE_URL}/telegram/files`);
        return response.json();
    },

    // Get specific file
    getFile: async (fileId: string) => {
        const response = await fetch(
            `${API_BASE_URL}/telegram/files/${fileId}`
        );
        return response.json();
    },

    // Download a file
    downloadFile: async (fileId: string) => {
        const response = await fetch(
            `${API_BASE_URL}/telegram/files/${fileId}/download`
        );
        return response.blob();
    },

    // Delete a file
    deleteFile: async (fileId: string) => {
        const response = await fetch(
            `${API_BASE_URL}/telegram/files/${fileId}`,
            {
                method: "DELETE",
            }
        );
        return response.json();
    },

    // Send Telegram message
    sendMessage: async (chatId: string, message: string) => {
        console.log(`Sending Telegram message to chat ID: ${chatId}`);
        const response = await fetch(`${API_BASE_URL}/proxy/telegram/send`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                chatId,
                message,
            }),
        });
        return response.json();
    },
};

// ArDrive API
export const ardriveApi = {
    // Get wallet balance
    getBalance: async () => {
        const response = await fetch(
            `${API_BASE_URL}/telegram/ardrive/balance`
        );
        return response.json();
    },

    // Get pending upload files
    getPendingUploads: async () => {
        const response = await fetch(
            `${API_BASE_URL}/telegram/ardrive/pending`
        );
        return response.json();
    },

    // Get upload cost estimate
    getUploadCost: async (fileId: string) => {
        const response = await fetch(
            `${API_BASE_URL}/telegram/ardrive/files/${fileId}/cost`
        );
        return response.json();
    },

    // Upload a file to ArDrive
    uploadFile: async (fileId: string) => {
        const response = await fetch(
            `${API_BASE_URL}/telegram/ardrive/files/${fileId}/upload`,
            {
                method: "POST",
            }
        );
        return response.json();
    },
};

// Node execution functions
export const nodeExecutors = {
    // Execute the APM Version Trigger node
    executeAPMVersionTrigger: async (config: any) => {
        try {
            // Ensure we have required config properties with defaults
            const safeConfig = {
                packageName: config.packageName || "markdown", // Default to 'markdown' package
                checkInterval: parseInt(config.checkInterval) || 60, // seconds
            };

            console.log("Executing APM Version Trigger node with config:", safeConfig);

            // Validate necessary parameters
            if (!safeConfig.packageName) {
                throw new Error("Missing required parameter: packageName");
            }

            // Variables for tracking state
            let pollInterval: NodeJS.Timeout | null = null;
            let latestKnownVersion: string | null = null;

            // Return object with methods for controlling the node
            return {
                // Start polling for new package versions
                startPolling: (callback: (versionData: any) => void) => {
                    const checkIntervalMs = safeConfig.checkInterval * 1000;
                    console.log(`Starting to poll for ${safeConfig.packageName} updates every ${checkIntervalMs}ms`);

                    // Clear any existing interval
                    if (pollInterval) {
                        clearInterval(pollInterval);
                        pollInterval = null;
                    }

                    // Make initial query to get the current latest version
                    apmApi.queryPackagePublications(safeConfig.packageName)
                        .then(initialResult => {
                            if (initialResult.success && initialResult.latestVersion) {
                                latestKnownVersion = initialResult.latestVersion;
                                console.log(`Initial version of ${safeConfig.packageName}: ${latestKnownVersion}`);
                            }
                        })
                        .catch(err => {
                            console.error("Error getting initial version:", err);
                        });

                    // Set up polling
                    pollInterval = setInterval(async () => {
                        try {
                            // Query for the latest version
                            const result = await apmApi.queryPackagePublications(safeConfig.packageName);

                            if (!result.success || !result.publications || result.publications.length === 0) {
                                console.error(`Failed to fetch ${safeConfig.packageName} publications:`, result.error);
                                return;
                            }

                            const currentLatestVersion = result.latestVersion;
                            console.log(`Current latest version of ${safeConfig.packageName}: ${currentLatestVersion}`);
                            console.log(`Previously known version: ${latestKnownVersion || 'none'}`);

                            // If this is our first check, just record the latest version
                            if (latestKnownVersion === null) {
                                latestKnownVersion = currentLatestVersion || null;
                                console.log(`Recorded initial version: ${latestKnownVersion}`);
                                return;
                            }

                            // Check if we have a new version
                            const isNewVersion = latestKnownVersion !== null &&
                                currentLatestVersion !== undefined &&
                                currentLatestVersion !== latestKnownVersion;

                            // If we have a new version, trigger the callback
                            if (isNewVersion && currentLatestVersion) {
                                console.log(`New version detected! ${safeConfig.packageName} updated from ${latestKnownVersion} to ${currentLatestVersion}`);

                                // Update our latest known version
                                latestKnownVersion = currentLatestVersion;

                                // Create version data for the callback
                                const versionData = {
                                    packageName: safeConfig.packageName,
                                    version: currentLatestVersion,
                                    timestamp: new Date().toISOString(),
                                    publicationDetails: result.publications[0],
                                    message: `New version of ${safeConfig.packageName} published: ${currentLatestVersion}`
                                };

                                // Trigger the callback
                                callback(versionData);
                            }
                        } catch (error) {
                            console.error("Error during APM version polling:", error);
                        }
                    }, checkIntervalMs);
                },

                // Manually check current version (for testing or UI feedback)
                checkCurrentVersion: async () => {
                    return await apmApi.queryPackagePublications(safeConfig.packageName);
                },

                // Stop polling
                stop: async () => {
                    console.log(`Stopping version polling for ${safeConfig.packageName}`);
                    if (pollInterval) {
                        clearInterval(pollInterval);
                        pollInterval = null;
                    }
                    return { success: true };
                },
            };
        } catch (error) {
            console.error("Error executing APM Version Trigger node:", error);
            throw error;
        }
    },

    // Execute the Crypto Price Trigger node
    executeCryptoPriceTrigger: async (config: any) => {
        try {
            // Ensure we have required config properties with defaults
            const safeConfig = {
                token: config.token || "arweave",
                targetPrice: parseFloat(config.targetPrice) || 0,
                comparisonType: config.comparisonType || "above", // 'above' or 'below'
                checkInterval: parseInt(config.checkInterval) || 30, // seconds
            };

            console.log("Executing Crypto Price Trigger node with config:", safeConfig);

            // Validate necessary parameters
            if (!safeConfig.targetPrice) {
                throw new Error("Missing required parameter: targetPrice");
            }

            // Set up polling for price changes
            let pollInterval: NodeJS.Timeout | null = null;
            let isTriggered = false;

            // Return object with methods for controlling the node
            return {
                // Start polling for price changes
                startPolling: (callback: (priceData: any) => void) => {
                    const checkIntervalMs = safeConfig.checkInterval * 1000;
                    console.log(`Starting to poll for ${safeConfig.token} price every ${checkIntervalMs}ms`);
                    console.log(`Waiting for price to go ${safeConfig.comparisonType} $${safeConfig.targetPrice}`);

                    // Clear any existing interval
                    if (pollInterval) {
                        clearInterval(pollInterval);
                        pollInterval = null;
                    }

                    // Reset triggered state
                    isTriggered = false;

                    // Set up polling
                    pollInterval = setInterval(async () => {
                        try {
                            // Skip if already triggered - we only want to trigger once
                            if (isTriggered) return;

                            // Fetch current price
                            const priceResponse = await cryptocurrencyApi.fetchPrice(safeConfig.token);

                            if (!priceResponse.success || !priceResponse.price) {
                                console.error(`Failed to fetch ${safeConfig.token} price:`, priceResponse.error);
                                return;
                            }

                            console.log(`Current ${safeConfig.token} price: $${priceResponse.price}`);

                            // Check if price meets the target condition
                            let conditionMet = false;

                            if (safeConfig.comparisonType === "above") {
                                conditionMet = priceResponse.price >= safeConfig.targetPrice;
                            } else if (safeConfig.comparisonType === "below") {
                                conditionMet = priceResponse.price <= safeConfig.targetPrice;
                            }

                            // If price condition is met, trigger the callback
                            if (conditionMet) {
                                console.log(`Price condition met! ${safeConfig.token} price is ${safeConfig.comparisonType} $${safeConfig.targetPrice}`);

                                // Mark as triggered to prevent multiple executions
                                isTriggered = true;

                                // Create price data for the callback
                                const priceData = {
                                    token: safeConfig.token,
                                    price: priceResponse.price,
                                    targetPrice: safeConfig.targetPrice,
                                    comparisonType: safeConfig.comparisonType,
                                    timestamp: new Date().toISOString(),
                                    message: `${safeConfig.token.toUpperCase()} price is now $${priceResponse.price}, which is ${safeConfig.comparisonType} the target of $${safeConfig.targetPrice}`
                                };

                                // Trigger the callback
                                callback(priceData);

                                // Clear the interval
                                if (pollInterval) {
                                    clearInterval(pollInterval);
                                    pollInterval = null;
                                }
                            }
                        } catch (error) {
                            console.error("Error during price polling:", error);
                        }
                    }, checkIntervalMs);
                },

                // Manually check current price (for testing or UI feedback)
                checkPrice: async () => {
                    return await cryptocurrencyApi.fetchPrice(safeConfig.token);
                },

                // Stop polling
                stop: async () => {
                    console.log(`Stopping price polling for ${safeConfig.token}`);
                    if (pollInterval) {
                        clearInterval(pollInterval);
                        pollInterval = null;
                    }
                    isTriggered = false;
                    return { success: true };
                },
            };
        } catch (error) {
            console.error("Error executing Crypto Price Trigger node:", error);
            throw error;
        }
    },

    // Execute the Receive Telegram node
    executeTelegramReceive: async (config: any) => {
        try {
            // Ensure we have required config properties
            const safeConfig = {
                checkInterval: config.checkInterval || "10",
                messageTypes: config.messageTypes || "all",
                maxFileSizeInMB: config.maxFileSizeInMB || "50",
            };

            console.log(
                "Executing Telegram Receive node with config:",
                safeConfig
            );

            // Initialize the bot and wait for successful completion
            const initResponse = await telegramApi.initialize();

            if (!initResponse || !initResponse.success) {
                throw new Error(
                    `Failed to initialize Telegram bot: ${initResponse?.message || "Unknown error"
                    }`
                );
            }

            console.log(
                "Telegram bot initialized successfully:",
                initResponse.status.botInfo?.username
            );

            // Only start the bot after successful initialization
            const startResponse = await telegramApi.start();

            if (!startResponse || !startResponse.success) {
                throw new Error(
                    `Failed to start Telegram bot: ${startResponse?.message || "Unknown error"
                    }`
                );
            }

            console.log(
                "Telegram bot started successfully:",
                startResponse.status.botInfo?.username
            );

            // Set up polling for new messages
            let pollInterval: NodeJS.Timeout | null = null;

            // Return object with methods for controlling the node
            return {
                // Process messages once and return results
                processExistingMessages: async () => {
                    try {
                        console.log("Processing existing messages...");

                        // Check if the bot is still active
                        if (!isBotActive) {
                            console.log(
                                "Bot is no longer active, not processing messages"
                            );
                            return [];
                        }

                        const processedFiles = [];

                        // First, check for any pending messages
                        const pendingResponse =
                            await telegramApi.getPendingMessages();
                        if (
                            pendingResponse.success &&
                            pendingResponse.pendingMessages &&
                            pendingResponse.pendingMessages.length > 0
                        ) {
                            console.log(
                                `Found ${pendingResponse.pendingMessages.length} pending messages`
                            );

                            for (const message of pendingResponse.pendingMessages) {
                                // Skip messages that don't match the filter if not set to 'all'
                                if (
                                    safeConfig.messageTypes !== "all" &&
                                    message.type !== safeConfig.messageTypes
                                ) {
                                    console.log(
                                        `Skipping message of type ${message.type} (filter: ${safeConfig.messageTypes})`
                                    );
                                    continue;
                                }

                                console.log(
                                    `Processing message ${message.id} of type ${message.type}`
                                );
                                // Process the message
                                const processResult =
                                    await telegramApi.processMessage(
                                        message.id
                                    );

                                if (
                                    processResult.success &&
                                    processResult.file
                                ) {
                                    console.log(
                                        `Successfully processed file: ${processResult.file.fileName} (${processResult.file.id})`
                                    );
                                    processedFiles.push(processResult.file);
                                } else {
                                    console.error(
                                        "Failed to process message:",
                                        processResult.error || "Unknown error"
                                    );
                                }
                            }
                        } else {
                            console.log("No pending messages found");
                        }

                        console.log(
                            `Total processed files: ${processedFiles.length}`
                        );
                        return processedFiles;
                    } catch (error) {
                        console.error("Error processing messages:", error);
                        throw error;
                    }
                },

                // Process only recent files (useful for direct API calls)
                processRecentFiles: async () => {
                    try {
                        console.log("Processing recent files only...");

                        // Check if the bot is still active
                        if (!isBotActive) {
                            console.log(
                                "Bot is no longer active, not processing files"
                            );
                            return [];
                        }

                        // Get recent files
                        const recentFilesResponse =
                            await telegramApi.getRecentFiles();

                        // Check if we have new files
                        if (
                            recentFilesResponse.success &&
                            recentFilesResponse.hasNewFiles &&
                            recentFilesResponse.latestFileId
                        ) {
                            console.log(
                                `Found new files! Latest file ID: ${recentFilesResponse.latestFileId}`
                            );

                            // Get just the latest file to return
                            const latestFile = recentFilesResponse.files.find(
                                (file: any) =>
                                    file.id === recentFilesResponse.latestFileId
                            );

                            if (latestFile) {
                                console.log(
                                    `Latest file: ${latestFile.fileName} (${latestFile.id})`
                                );

                                // Call the callback if it exists (to process the file immediately)
                                if (onNewFileProcessed) {
                                    console.log(
                                        `Triggering immediate processing for latest file: ${latestFile.fileName}`
                                    );
                                    onNewFileProcessed(latestFile);
                                }

                                return [latestFile]; // Only return the latest file
                            }
                        } else {
                            console.log("No new files found");
                        }

                        return []; // Return empty array if no new files
                    } catch (error) {
                        console.error("Error processing recent files:", error);
                        throw error;
                    }
                },

                // Start polling for new messages
                startPolling: (callback: (fileData: any) => void) => {
                    const checkIntervalMs =
                        parseInt(safeConfig.checkInterval, 10) * 1000;
                    console.log(
                        `Starting to poll for new files every ${checkIntervalMs}ms`
                    );

                    // Register callback
                    telegramApi.registerFileProcessedCallback(callback);

                    // Clear any existing interval
                    if (pollInterval) {
                        clearInterval(pollInterval);
                        pollInterval = null;
                    }

                    // Set up polling
                    pollInterval = setInterval(async () => {
                        if (!isBotActive) {
                            console.log(
                                "Bot is no longer active, stopping polling"
                            );
                            if (pollInterval) {
                                clearInterval(pollInterval);
                                pollInterval = null;
                            }
                            return;
                        }

                        try {
                            // Check for recent files (this is our primary method now)
                            const recentFilesResponse =
                                await telegramApi.getRecentFiles();

                            // Only process if we have new files (based on lastProcessedFileId tracking)
                            if (
                                recentFilesResponse.success &&
                                recentFilesResponse.hasNewFiles &&
                                recentFilesResponse.latestFileId
                            ) {
                                console.log(
                                    `Poll found new file with ID: ${recentFilesResponse.latestFileId}`
                                );

                                // Get the latest file
                                const latestFile =
                                    recentFilesResponse.files.find(
                                        (file: any) =>
                                            file.id ===
                                            recentFilesResponse.latestFileId
                                    );

                                if (latestFile && onNewFileProcessed) {
                                    console.log(
                                        `New file found during polling: ${latestFile.fileName}`
                                    );
                                    onNewFileProcessed(latestFile);
                                }
                            }
                        } catch (error) {
                            console.error("Error during polling:", error);
                        }
                    }, checkIntervalMs);
                },

                stop: async () => {
                    // Stop polling
                    if (pollInterval) {
                        clearInterval(pollInterval);
                        pollInterval = null;
                    }

                    // Stop the bot
                    try {
                        const stopResponse = await telegramApi.stop();

                        if (!stopResponse || !stopResponse.success) {
                            console.error(
                                `Failed to stop Telegram bot: ${stopResponse?.message || "Unknown error"
                                }`
                            );
                        } else {
                            console.log(
                                "Telegram bot stopped successfully:",
                                stopResponse.status.botInfo?.username
                            );
                        }
                    } catch (error) {
                        console.error("Error stopping Telegram bot:", error);
                    }
                },
            };
        } catch (error) {
            console.error("Error executing Telegram Receive node:", error);
            throw error;
        }
    },

    // Execute the Upload to Arweave node
    executeArweaveUpload: async (config: any, fileData: any) => {
        try {
            // Ensure we have required config properties
            const safeConfig = {
                tags: config.tags || "",
                permanent: config.permanent || "true",
            };

            console.log("Arweave node received file data:", fileData);

            if (!fileData || !fileData.id) {
                throw new Error(
                    "No valid file data provided to upload. Received: " +
                    JSON.stringify(fileData)
                );
            }

            // Get the upload cost
            console.log(`Getting upload cost for file ID: ${fileData.id}`);
            const costResponse = await ardriveApi.getUploadCost(fileData.id);

            if (!costResponse.success) {
                throw new Error(
                    `Failed to get upload cost: ${costResponse.error || "Unknown error"
                    }`
                );
            }

            console.log(`Upload cost: ${costResponse.cost} AR`);

            // Upload the file to Arweave
            console.log(`Uploading file ID: ${fileData.id} to Arweave`);
            const uploadResponse = await ardriveApi.uploadFile(fileData.id);

            if (!uploadResponse.success) {
                throw new Error(
                    `Failed to upload file: ${uploadResponse.error || "Unknown error"
                    }`
                );
            }

            console.log(
                `File uploaded successfully to Arweave. Response:`, uploadResponse
            );

            // Create a consistent response structure
            // Extract the transaction ID from the response, checking different possible formats
            const transactionId = uploadResponse.data?.transactionId ||
                uploadResponse.transactionId ||
                uploadResponse.id;

            // Extract the Arweave URL, checking different possible formats
            let arweaveUrl = uploadResponse.data?.arweave_url ||
                uploadResponse.data?.arweaveUrl ||
                uploadResponse.arweave_url ||
                uploadResponse.arweaveUrl;

            // If no arweave_url is provided but we have transaction ID, construct the URL
            if (!arweaveUrl && transactionId) {
                console.log(`No arweave_url provided in response, constructing from transaction ID: ${transactionId}`);
                arweaveUrl = `https://arweave.net/${transactionId}`;
            }

            // Log the URL for debugging
            if (arweaveUrl) {
                console.log(`Final Arweave URL: ${arweaveUrl}`);
            } else {
                console.warn(`Could not determine Arweave URL from response:`, uploadResponse);
            }

            // Return a consistent structure
            const result = {
                ...(uploadResponse.data || {}),
                arweave_url: arweaveUrl,
                arweaveUrl: arweaveUrl, // Add camelCase version for consistency
                transactionId: transactionId,
                originalFile: fileData,
            };

            console.log(`Final result object:`, result);
            return result;
        } catch (error) {
            console.error("Error executing Arweave Upload node:", error);
            throw error;
        }
    },

    // Execute the Send Telegram node
    executeTelegramSend: async (config: any, inputData: any) => {
        try {
            // Ensure we have required config properties
            const safeConfig = {
                chatId: config.chatId || "",
                message: config.message || "",
            };

            console.log(
                "Executing Send Telegram node with config:",
                safeConfig
            );
            console.log("Input data received:", inputData);

            // If no chat ID is provided, throw an error
            if (!safeConfig.chatId) {
                throw new Error("No chat ID provided for Telegram message");
            }

            // If no message is provided, throw an error
            if (!safeConfig.message) {
                throw new Error(
                    "No message content provided for Telegram message"
                );
            }

            // Process message template with variables
            let finalMessage = safeConfig.message;

            // Check if we have Arweave URL in the input data
            if (inputData) {
                console.log("Processing message template with input data");

                // Check for Arweave URL in different possible formats
                const arweaveUrl = inputData.arweave_url ||
                    inputData.arweaveUrl ||
                    (inputData.upload_result && inputData.upload_result.arweave_url) ||
                    (inputData.data && inputData.data.arweave_url);

                if (arweaveUrl) {
                    console.log(`Found Arweave URL: ${arweaveUrl}`);

                    // Check if message already contains the URL template or URL value
                    const containsTemplate = finalMessage.includes('{arweave_url}');
                    const containsUrl = finalMessage.includes(arweaveUrl);

                    if (containsTemplate) {
                        // Replace template variable with actual URL
                        finalMessage = finalMessage.replace(/\{arweave_url\}/g, arweaveUrl);
                        console.log(`Replaced {arweave_url} template with actual URL`);
                    } else if (!containsUrl && inputData.isFromArweaveNode) {
                        // Only auto-append if this data is coming directly from an Arweave node
                        console.log(`Message doesn't contain URL template or actual URL and data is from Arweave node, appending URL automatically`);

                        // Format the message nicely depending on its current content
                        if (finalMessage.trim() === '') {
                            // If message is empty, just use the URL
                            finalMessage = `File uploaded to Arweave: ${arweaveUrl}`;
                        } else if (finalMessage.endsWith('.') || finalMessage.endsWith('!') || finalMessage.endsWith('?') || finalMessage.endsWith(':')) {
                            // If message ends with punctuation, add the URL on a new line
                            finalMessage = `${finalMessage}\n\nFile uploaded to Arweave: ${arweaveUrl}`;
                        } else {
                            // Otherwise add with proper punctuation
                            finalMessage = `${finalMessage}. File uploaded to Arweave: ${arweaveUrl}`;
                        }
                    } else if (!containsUrl && !inputData.isFromArweaveNode) {
                        // If not from Arweave node, don't auto-append but log it was found
                        console.log(`Arweave URL found but not auto-appending as this is not directly from an Arweave node`);
                    }
                } else {
                    console.warn("No Arweave URL found in input data");
                }

                // If message contains filename template and we have filename in input
                if (inputData.fileName || inputData.originalFile?.fileName) {
                    const fileName = inputData.fileName || inputData.originalFile?.fileName;
                    finalMessage = finalMessage.replace(/\{filename\}/g, fileName);
                }
            }

            console.log(`Final message after template processing: ${finalMessage}`);

            // Send the Telegram message
            console.log(
                `Sending Telegram message to chat ID: ${safeConfig.chatId}`
            );
            const sendResponse = await telegramApi.sendMessage(
                safeConfig.chatId,
                finalMessage
            );

            if (!sendResponse.success) {
                throw new Error(
                    `Failed to send Telegram message: ${sendResponse.error || "Unknown error"
                    }`
                );
            }

            console.log(
                `Message sent successfully to chat ID: ${safeConfig.chatId}`
            );

            return {
                success: true,
                sentTo: safeConfig.chatId,
                message: finalMessage,
                originalMessage: safeConfig.message,
                response: sendResponse,
                inputData,
            };
        } catch (error) {
            console.error("Error executing Send Telegram node:", error);
            throw error;
        }
    },
};
