// src/controllers/chatController.js - Fixed Session Management
const { pool } = require('../config/database');

class ChatController {
    // Create/Save chat conversation with FIXED logic
    async createChat(req, res, next) {
        let client;

        try {
            const { user_id, conversation, status } = req.body;

            if (!user_id || !conversation) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    details: 'user_id and conversation are required'
                });
            }

            const validStatuses = ['paused', 'completed', 'stopped', 'incomplete'];
            const finalStatus = validStatuses.includes(status) ? status : 'incomplete';

            if (!Array.isArray(conversation)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid conversation format',
                    details: 'conversation must be an array'
                });
            }

            console.log(`💾 Creating chat for ${user_id} with status: ${finalStatus}`);

            client = await pool.connect();

            try {
                await client.query('BEGIN');

                // CRITICAL FIX: When saving as completed/stopped, archive ALL active conversations
                if (finalStatus === 'completed' || finalStatus === 'stopped') {
                    const archiveResult = await client.query(
                        `UPDATE chat 
                         SET status = 'archived', updated_at = CURRENT_TIMESTAMP 
                         WHERE user_id = $1 AND status IN ('incomplete', 'paused', 'stopped')
                         RETURNING id, status`,
                        [user_id]
                    );
                    
                    console.log(`📚 Archived ${archiveResult.rows.length} active conversations for ${user_id}`);
                    archiveResult.rows.forEach(row => {
                        console.log(`  - Archived chat ID ${row.id} (was ${row.status})`);
                    });
                }

                // Insert new chat
                const insertResult = await client.query(
                    `INSERT INTO chat (user_id, conversation, status, created_at, updated_at) 
                     VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
                     RETURNING id, created_at, updated_at`,
                    [user_id, JSON.stringify(conversation), finalStatus]
                );

                await client.query('COMMIT');

                const newChat = insertResult.rows[0];

                console.log(`✅ Chat created successfully: ${user_id} - ${finalStatus} (ID: ${newChat.id})`);

                res.status(201).json({
                    success: true,
                    message: 'Chat stored successfully',
                    data: {
                        id: newChat.id,
                        user_id,
                        conversation,
                        status: finalStatus,
                        created_at: newChat.created_at,
                        updated_at: newChat.updated_at,
                        // CRITICAL: Always indicate fresh start after completion/stop
                        shouldStartFresh: finalStatus === 'completed' || finalStatus === 'stopped'
                    }
                });

            } catch (transactionError) {
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackError) {
                    console.error('Rollback failed:', rollbackError);
                }
                throw transactionError;
            }

        } catch (error) {
            console.error('❌ Error creating chat:', error);
            return res.status(500).json({
                success: false,
                error: 'Database error',
                message: 'Failed to store chat',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        } finally {
            if (client) {
                try {
                    client.release();
                } catch (releaseError) {
                    console.error('Error releasing client:', releaseError);
                }
            }
        }
    }

    // FIXED: Get session status with proper logic
    async getSessionStatus(req, res, next) {
        try {
            const { user_id } = req.params;

            if (!user_id) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required parameter: user_id'
                });
            }

            console.log(`🔍 Checking session status for user: ${user_id}`);

            // CRITICAL: Only look for paused, stopped, or incomplete (NOT completed or archived)
            const activeResult = await pool.query(
                `SELECT id, user_id, conversation, status, created_at, updated_at 
                 FROM chat 
                 WHERE user_id = $1 AND status IN ('paused', 'stopped', 'incomplete') 
                 ORDER BY updated_at DESC 
                 LIMIT 1`,
                [user_id]
            );

            if (activeResult.rows.length > 0) {
                // User has an active conversation to resume
                const chat = activeResult.rows[0];
                if (typeof chat.conversation === 'string') {
                    try {
                        chat.conversation = JSON.parse(chat.conversation);
                    } catch (parseError) {
                        console.error('Error parsing conversation JSON:', parseError);
                    }
                }

                console.log(`🔄 Found ${chat.status} conversation to resume (ID: ${chat.id})`);

                return res.json({
                    success: true,
                    data: {
                        sessionType: 'resume',
                        hasActiveSession: true,
                        shouldStartFresh: false,
                        chat: chat,
                        message: `Found ${chat.status} conversation to resume`
                    }
                });
            }

            // Check if user has any completed sessions (for logging purposes)
            const completedResult = await pool.query(
                `SELECT COUNT(*) as count FROM chat 
                 WHERE user_id = $1 AND status IN ('completed', 'archived')`,
                [user_id]
            );

            const completedCount = parseInt(completedResult.rows[0].count, 10);
            
            console.log(`🆕 No active sessions for ${user_id}. Completed/Archived: ${completedCount}`);

            return res.json({
                success: true,
                data: {
                    sessionType: 'fresh',
                    hasActiveSession: false,
                    shouldStartFresh: true,
                    chat: null,
                    message: `No active conversations found. Starting fresh session. (${completedCount} completed sessions in history)`
                }
            });

        } catch (error) {
            console.error('❌ Error checking session status:', error);
            return res.status(500).json({
                success: false,
                error: 'Database error',
                message: 'Failed to check session status',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // FIXED: Update conversation with proper archiving
    async updateConversation(req, res, next) {
        let client;

        try {
            const { chat_id } = req.params;
            const { conversation, status = 'incomplete' } = req.body;

            if (!chat_id || !conversation) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields: chat_id and conversation'
                });
            }

            const validStatuses = ['paused', 'completed', 'stopped', 'incomplete'];
            const finalStatus = validStatuses.includes(status) ? status : 'incomplete';

            console.log(`📝 Updating conversation ID: ${chat_id} with status: ${finalStatus}`);

            client = await pool.connect();

            try {
                await client.query('BEGIN');

                // Check if chat exists and get current info
                const checkResult = await client.query(
                    'SELECT id, user_id, status FROM chat WHERE id = $1',
                    [parseInt(chat_id)]
                );

                if (checkResult.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({
                        success: false,
                        error: 'Chat not found'
                    });
                }

                const existingChat = checkResult.rows[0];

                // CRITICAL FIX: If updating to completed/stopped, archive OTHER active chats
                if (finalStatus === 'completed' || finalStatus === 'stopped') {
                    const archiveResult = await client.query(
                        `UPDATE chat 
                         SET status = 'archived', updated_at = CURRENT_TIMESTAMP 
                         WHERE user_id = $1 AND status IN ('incomplete', 'paused', 'stopped') AND id != $2
                         RETURNING id, status`,
                        [existingChat.user_id, parseInt(chat_id)]
                    );
                    
                    console.log(`📚 Archived ${archiveResult.rows.length} other active conversations`);
                    archiveResult.rows.forEach(row => {
                        console.log(`  - Archived chat ID ${row.id} (was ${row.status})`);
                    });
                }

                // Update the current conversation
                const updateResult = await client.query(
                    `UPDATE chat 
                     SET conversation = $1, status = $2, updated_at = CURRENT_TIMESTAMP 
                     WHERE id = $3 
                     RETURNING id, user_id, conversation, status, updated_at`,
                    [JSON.stringify(conversation), finalStatus, parseInt(chat_id)]
                );

                await client.query('COMMIT');

                const updatedChat = updateResult.rows[0];
                if (typeof updatedChat.conversation === 'string') {
                    try {
                        updatedChat.conversation = JSON.parse(updatedChat.conversation);
                    } catch (parseError) {
                        console.error('Error parsing conversation JSON:', parseError);
                    }
                }

                console.log(`✅ Conversation updated: ID ${chat_id} -> ${finalStatus}`);

                res.json({
                    success: true,
                    message: 'Conversation updated successfully',
                    data: {
                        ...updatedChat,
                        // CRITICAL: Indicate fresh start after completion/stop
                        shouldStartFresh: finalStatus === 'completed' || finalStatus === 'stopped'
                    }
                });

            } catch (transactionError) {
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackError) {
                    console.error('Rollback failed:', rollbackError);
                }
                throw transactionError;
            }

        } catch (error) {
            console.error('❌ Error updating conversation:', error);
            return res.status(500).json({
                success: false,
                error: 'Database error',
                message: 'Failed to update conversation',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        } finally {
            if (client) {
                try {
                    client.release();
                } catch (releaseError) {
                    console.error('Error releasing client:', releaseError);
                }
            }
        }
    }

    // Get chat counts by status for user
    async getChatCounts(req, res, next) {
        try {
            const { user_id } = req.params;

            if (!user_id) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required parameter: user_id'
                });
            }

            const counts = {};

            // Get counts for each status
            const statuses = ['stopped', 'paused', 'completed', 'incomplete', 'archived'];
            
            for (const status of statuses) {
                const result = await pool.query(
                    'SELECT COUNT(*) as count FROM chat WHERE user_id = $1 AND status = $2',
                    [user_id, status]
                );
                counts[status] = parseInt(result.rows[0].count, 10);
            }

            // Calculate derived counts
            counts.active = counts.paused + counts.stopped + counts.incomplete;
            
            // Get total count
            const totalResult = await pool.query(
                'SELECT COUNT(*) as count FROM chat WHERE user_id = $1',
                [user_id]
            );
            counts.total = parseInt(totalResult.rows[0].count, 10);

            res.json({ 
                success: true,
                data: {
                    user_id, 
                    counts 
                }
            });

        } catch (error) {
            console.error('❌ Error fetching chat counts:', error);
            return res.status(500).json({
                success: false,
                error: 'Database error',
                message: 'Failed to fetch chat counts',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // Get chat history by status with pagination
    async getChatHistory(req, res, next) {
        try {
            const { user_id } = req.params;
            const { status = 'all', limit = 20, offset = 0 } = req.query;

            if (!user_id) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required parameter: user_id'
                });
            }

            let query, params, countQuery, countParams;

            if (status === 'all') {
                query = `SELECT id, user_id, conversation, status, created_at, updated_at 
                        FROM chat 
                        WHERE user_id = $1 
                        ORDER BY updated_at DESC 
                        LIMIT $2 OFFSET $3`;
                params = [user_id, parseInt(limit), parseInt(offset)];

                countQuery = `SELECT COUNT(*) as total FROM chat WHERE user_id = $1`;
                countParams = [user_id];
            } else if (status === 'active') {
                // CRITICAL: Active only includes paused, stopped, incomplete (NOT completed/archived)
                query = `SELECT id, user_id, conversation, status, created_at, updated_at 
                        FROM chat 
                        WHERE user_id = $1 AND status IN ('paused', 'stopped', 'incomplete') 
                        ORDER BY updated_at DESC 
                        LIMIT $2 OFFSET $3`;
                params = [user_id, parseInt(limit), parseInt(offset)];

                countQuery = `SELECT COUNT(*) as total FROM chat WHERE user_id = $1 AND status IN ('paused', 'stopped', 'incomplete')`;
                countParams = [user_id];
            } else {
                const validStatuses = ['paused', 'completed', 'stopped', 'incomplete', 'archived'];
                if (!validStatuses.includes(status)) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid status',
                        message: `Status must be one of: ${validStatuses.join(', ')}, 'active', or 'all'`
                    });
                }

                query = `SELECT id, user_id, conversation, status, created_at, updated_at 
                        FROM chat 
                        WHERE user_id = $1 AND status = $2 
                        ORDER BY updated_at DESC 
                        LIMIT $3 OFFSET $4`;
                params = [user_id, status, parseInt(limit), parseInt(offset)];

                countQuery = `SELECT COUNT(*) as total FROM chat WHERE user_id = $1 AND status = $2`;
                countParams = [user_id, status];
            }

            const result = await pool.query(query, params);
            const countResult = await pool.query(countQuery, countParams);

            // Parse conversation JSON for each chat
            const chats = result.rows.map(chat => {
                if (typeof chat.conversation === 'string') {
                    try {
                        chat.conversation = JSON.parse(chat.conversation);
                    } catch (parseError) {
                        console.error('Error parsing conversation JSON:', parseError);
                    }
                }
                return chat;
            });

            const total = parseInt(countResult.rows[0].total, 10);

            res.json({
                success: true,
                data: {
                    chats,
                    filter: status,
                    pagination: {
                        total,
                        limit: parseInt(limit),
                        offset: parseInt(offset),
                        hasMore: (parseInt(offset) + parseInt(limit)) < total
                    }
                }
            });

        } catch (error) {
            console.error('❌ Error fetching chat history:', error);
            return res.status(500).json({
                success: false,
                error: 'Database error',
                message: 'Failed to fetch chat history',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // Delete chat
    async deleteChat(req, res, next) {
        let client;

        try {
            const { chat_id } = req.params;

            if (!chat_id) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required parameter: chat_id'
                });
            }

            client = await pool.connect();

            try {
                await client.query('BEGIN');

                const result = await client.query(
                    'DELETE FROM chat WHERE id = $1 RETURNING id, user_id, status',
                    [parseInt(chat_id)]
                );

                if (result.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({
                        success: false,
                        error: 'Chat not found'
                    });
                }

                await client.query('COMMIT');

                res.json({
                    success: true,
                    message: 'Chat deleted successfully',
                    data: result.rows[0]
                });

            } catch (transactionError) {
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackError) {
                    console.error('Rollback failed:', rollbackError);
                }
                throw transactionError;
            }

        } catch (error) {
            console.error('❌ Error deleting chat:', error);
            return res.status(500).json({
                success: false,
                error: 'Database error',
                message: 'Failed to delete chat',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        } finally {
            if (client) {
                try {
                    client.release();
                } catch (releaseError) {
                    console.error('Error releasing client:', releaseError);
                }
            }
        }
    }

    // Get chat by ID
    async getChatById(req, res, next) {
        try {
            const { chat_id } = req.params;

            if (!chat_id) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required parameter: chat_id'
                });
            }

            const result = await pool.query(
                'SELECT id, user_id, conversation, status, created_at, updated_at FROM chat WHERE id = $1',
                [parseInt(chat_id)]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Chat not found'
                });
            }

            const chat = result.rows[0];
            if (typeof chat.conversation === 'string') {
                try {
                    chat.conversation = JSON.parse(chat.conversation);
                } catch (parseError) {
                    console.error('Error parsing conversation JSON:', parseError);
                }
            }

            res.json({
                success: true,
                data: { chat }
            });

        } catch (error) {
            console.error('❌ Error fetching chat by ID:', error);
            return res.status(500).json({
                success: false,
                error: 'Database error',
                message: 'Failed to fetch chat',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // DEPRECATED: For backward compatibility
    async getLatestChat(req, res, next) {
        console.warn('⚠️ getLatestChat is deprecated. Use getSessionStatus instead.');
        return this.getSessionStatus(req, res, next);
    }
}

module.exports = new ChatController();