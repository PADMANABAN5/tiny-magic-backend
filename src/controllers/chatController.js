// src/controllers/chatController.js - Complete PostgreSQL Version
const { pool } = require('../config/database');

class ChatController {
    // Create/Save chat conversation
    async createChat(req, res, next) {
        let client;

        try {
            const { user_id, conversation, status } = req.body;

            // Validate required fields
            if (!user_id || !conversation) {
                return res.status(400).json({
                    error: 'Missing required fields',
                    details: 'user_id and conversation are required'
                });
            }

            // Validate status
            const validStatuses = ['paused', 'completed', 'stopped', 'incomplete'];
            const finalStatus = validStatuses.includes(status) ? status : 'incomplete';

            // Validate conversation is an array
            if (!Array.isArray(conversation)) {
                return res.status(400).json({
                    error: 'Invalid conversation format',
                    details: 'conversation must be an array'
                });
            }

            console.log('Inserting chat:', {
                user_id,
                conversation: JSON.stringify(conversation),
                status: finalStatus
            });

            // PostgreSQL connection pattern (same as templateController)
            client = await pool.connect();

            try {
                await client.query('BEGIN');

                // Insert new chat with PostgreSQL syntax
                const insertResult = await client.query(
                    'INSERT INTO chat (user_id, conversation, status, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id, created_at, updated_at',
                    [user_id, JSON.stringify(conversation), finalStatus]
                );

                await client.query('COMMIT');

                const newChat = insertResult.rows[0];

                console.log(`✅ Chat created successfully: ${user_id} - ${finalStatus}`);

                res.status(201).json({
                    success: true,
                    message: 'Chat stored successfully',
                    data: {
                        id: newChat.id,
                        user_id,
                        conversation,
                        status: finalStatus,
                        created_at: newChat.created_at,
                        updated_at: newChat.updated_at
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

            if (error.code === '23505') {
                return res.status(409).json({
                    error: 'Constraint violation',
                    message: 'Database constraint prevents this operation.'
                });
            }

            return res.status(500).json({
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

    // Get latest chat for user
    async getLatestChat(req, res, next) {
        try {
            const { user_id } = req.params;

            if (!user_id) {
                return res.status(400).json({
                    error: 'Missing required parameter: user_id'
                });
            }

            const result = await pool.query(
                'SELECT id, user_id, conversation, status, created_at, updated_at FROM chat WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
                [user_id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    message: 'No chat found for this user' 
                });
            }

            // Parse the JSON conversation back to object
            const chat = result.rows[0];
            if (typeof chat.conversation === 'string') {
                try {
                    chat.conversation = JSON.parse(chat.conversation);
                } catch (parseError) {
                    console.error('Error parsing conversation JSON:', parseError);
                    // Keep as string if parsing fails
                }
            }

            res.json({ 
                success: true,
                data: { chat } 
            });

        } catch (error) {
            console.error('❌ Error fetching latest chat:', error);
            return res.status(500).json({
                error: 'Database error',
                message: 'Failed to fetch latest chat',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // Get chat counts by status for user
    async getChatCounts(req, res, next) {
        try {
            const { user_id } = req.params;

            if (!user_id) {
                return res.status(400).json({
                    error: 'Missing required parameter: user_id'
                });
            }

            const counts = {};

            // Get count for 'stopped' status
            const stoppedResult = await pool.query(
                'SELECT COUNT(*) as count FROM chat WHERE user_id = $1 AND status = $2',
                [user_id, 'stopped']
            );
            counts.stopped = parseInt(stoppedResult.rows[0].count, 10);

            // Get count for 'paused' status
            const pausedResult = await pool.query(
                'SELECT COUNT(*) as count FROM chat WHERE user_id = $1 AND status = $2',
                [user_id, 'paused']
            );
            counts.paused = parseInt(pausedResult.rows[0].count, 10);

            // Get count for 'completed' status
            const completedResult = await pool.query(
                'SELECT COUNT(*) as count FROM chat WHERE user_id = $1 AND status = $2',
                [user_id, 'completed']
            );
            counts.completed = parseInt(completedResult.rows[0].count, 10);

            // Get count for 'incomplete' status
            const incompleteResult = await pool.query(
                'SELECT COUNT(*) as count FROM chat WHERE user_id = $1 AND status = $2',
                [user_id, 'incomplete']
            );
            counts.incomplete = parseInt(incompleteResult.rows[0].count, 10);

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
                error: 'Database error',
                message: 'Failed to fetch chat counts',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // Get all chats for a user with pagination
    async getUserChats(req, res, next) {
        try {
            const { user_id } = req.params;
            const { limit = 20, offset = 0, status } = req.query;

            if (!user_id) {
                return res.status(400).json({
                    error: 'Missing required parameter: user_id'
                });
            }

            let query = 'SELECT id, user_id, conversation, status, created_at, updated_at FROM chat WHERE user_id = $1';
            let params = [user_id];
            let paramCount = 1;

            // Add status filter if provided
            if (status) {
                paramCount++;
                query += ` AND status = $${paramCount}`;
                params.push(status);
            }

            // Add ordering and pagination
            paramCount++;
            query += ` ORDER BY created_at DESC LIMIT $${paramCount}`;
            params.push(parseInt(limit));
            
            paramCount++;
            query += ` OFFSET $${paramCount}`;
            params.push(parseInt(offset));

            const result = await pool.query(query, params);

            // Parse conversation JSON for each chat
            const chats = result.rows.map(chat => {
                if (typeof chat.conversation === 'string') {
                    try {
                        chat.conversation = JSON.parse(chat.conversation);
                    } catch (parseError) {
                        console.error('Error parsing conversation JSON:', parseError);
                        // Keep as string if parsing fails
                    }
                }
                return chat;
            });

            // Get total count for pagination
            let countQuery = 'SELECT COUNT(*) as total FROM chat WHERE user_id = $1';
            let countParams = [user_id];
            
            if (status) {
                countQuery += ' AND status = $2';
                countParams.push(status);
            }

            const countResult = await pool.query(countQuery, countParams);
            const total = parseInt(countResult.rows[0].total, 10);

            res.json({
                success: true,
                data: {
                    chats,
                    pagination: {
                        total,
                        limit: parseInt(limit),
                        offset: parseInt(offset),
                        hasMore: (parseInt(offset) + parseInt(limit)) < total
                    }
                }
            });

        } catch (error) {
            console.error('❌ Error fetching user chats:', error);
            return res.status(500).json({
                error: 'Database error',
                message: 'Failed to fetch user chats',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // Update chat status
    async updateChatStatus(req, res, next) {
        let client;

        try {
            const { chat_id } = req.params;
            const { status } = req.body;

            if (!chat_id || !status) {
                return res.status(400).json({
                    error: 'Missing required fields: chat_id and status'
                });
            }

            const validStatuses = ['paused', 'completed', 'stopped', 'incomplete'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    error: 'Invalid status',
                    message: `Status must be one of: ${validStatuses.join(', ')}`
                });
            }

            client = await pool.connect();

            try {
                await client.query('BEGIN');

                // Check if chat exists
                const checkResult = await client.query(
                    'SELECT id FROM chat WHERE id = $1',
                    [parseInt(chat_id)]
                );

                if (checkResult.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({
                        error: 'Chat not found'
                    });
                }

                // Update chat status
                const updateResult = await client.query(
                    'UPDATE chat SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, user_id, status, updated_at',
                    [status, parseInt(chat_id)]
                );

                await client.query('COMMIT');

                const updatedChat = updateResult.rows[0];

                res.json({
                    success: true,
                    message: 'Chat status updated successfully',
                    data: updatedChat
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
            console.error('❌ Error updating chat status:', error);
            return res.status(500).json({
                error: 'Database error',
                message: 'Failed to update chat status',
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

    // Delete chat
    async deleteChat(req, res, next) {
        let client;

        try {
            const { chat_id } = req.params;

            if (!chat_id) {
                return res.status(400).json({
                    error: 'Missing required parameter: chat_id'
                });
            }

            client = await pool.connect();

            try {
                await client.query('BEGIN');

                const result = await client.query(
                    'DELETE FROM chat WHERE id = $1 RETURNING id, user_id',
                    [parseInt(chat_id)]
                );

                if (result.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({
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
                    error: 'Missing required parameter: chat_id'
                });
            }

            const result = await pool.query(
                'SELECT id, user_id, conversation, status, created_at, updated_at FROM chat WHERE id = $1',
                [parseInt(chat_id)]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'Chat not found'
                });
            }

            // Parse the JSON conversation back to object
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
                error: 'Database error',
                message: 'Failed to fetch chat',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

module.exports = new ChatController();