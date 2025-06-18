// src/routes/templates/templates.js
const express = require('express');
const templateController = require('../../controllers/templateController');
const { 
    validateTemplate, 
    validateTemplateQuery, 
    validateTemplateDelete,
    validateTemplateRestore,
    validatePromptProcess,
    validateResetDefault,
    validateListQuery,
    validateDefaultsQuery
} = require('../../middleware/validation');

const router = express.Router();

// GET /api/templates - Get template(s)
// Query params: username, templateType, version?, includeHistory?
router.get('/', validateTemplateQuery, templateController.getTemplate);

// POST /api/templates - Create/Update template
// Body: { username, templateType, content }
router.post('/', validateTemplate, templateController.updateTemplate);

// PUT /api/templates - Alternative endpoint for updates
router.put('/', validateTemplate, templateController.updateTemplate);

// GET /api/templates/list - List all templates for user
// Query params: username
router.get('/list', validateListQuery, templateController.listTemplates);

// DELETE /api/templates - Delete template(s)
// Body: { username, templateType, version?, deleteAll? }
router.delete('/', validateTemplateDelete, templateController.deleteTemplate);

// POST /api/templates/restore - Restore previous version
// Body: { username, templateType, version }
router.post('/restore', validateTemplateRestore, templateController.restoreTemplate);

// GET /api/templates/defaults - Get default templates
// Query params: templateType?, format?
router.get('/defaults', validateDefaultsQuery, templateController.getDefaultTemplates);

// POST /api/templates/defaults - Reset template to default
// Body: { username, templateType, resetToDefault: true }
router.post('/defaults', validateResetDefault, templateController.resetToDefault);

// POST /api/templates/process - Process prompt with templates
// Body: { username, promptType, llmProvider?, userInput? }
router.post('/process', validatePromptProcess, templateController.processPrompt);

// Legacy route compatibility (from your Next.js API)
// POST /api/templates/update - Legacy update endpoint
router.post('/update', validateTemplate, templateController.updateTemplate);

// GET /api/templates/get - Legacy get endpoint 
router.get('/get', validateTemplateQuery, templateController.getTemplate);

// DELETE /api/templates/delete - Legacy delete endpoint
router.delete('/delete', validateTemplateDelete, templateController.deleteTemplate);

// Update ALL users with latest default template
// POST /api/templates/update-all-users  
// Body: { confirmUpdate: true }
router.post('/update-all-users', templateController.updateAllUsersToLatestDefaults);

module.exports = router;