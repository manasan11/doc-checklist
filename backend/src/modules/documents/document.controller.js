const documentService = require('./document.service');

async function getDocuments(req, res) {
  const studentIdParam = req.query.studentId || req.query.Student_Id;
  const deptIdParam = req.query.deptId || req.query.Dept_Id || req.query.departmentId;

  let targetUserId = (req.user.role === 'admin' && req.query.userId) 
    ? req.query.userId 
    : (studentIdParam ? `u-${String(studentIdParam).replace(/^u-/, '')}` : req.user.id);

  const syncDrive = req.query.sync === 'true' || req.query.syncDrive === 'true';

  try {
    const checklist = await documentService.getChecklist(targetUserId, studentIdParam, deptIdParam, syncDrive);
    return res.json(checklist);
  } catch (err) {
    console.error('[DocumentController] getDocuments error:', err);
    return res.status(500).json({ error: 'Failed to fetch checklist: ' + err.message });
  }
}

async function getStudentFollowupDocuments(req, res) {
  let studentId = req.params.studentId;
  const deptId = req.query.deptId || req.query.Dept_Id || req.query.departmentId;

  if (!studentId || studentId === ':studentId' || studentId.startsWith(':')) {
    studentId = (req.user && req.user.id) ? String(req.user.id).replace(/^u-/, '') : '8755';
  }

  if (!studentId) {
    return res.status(400).json({ error: 'Student_Id is required.' });
  }

  try {
    const result = await documentService.getFollowupDocuments(studentId, deptId);
    return res.json(result);
  } catch (err) {
    console.error('[DocumentController] getStudentFollowupDocuments error:', err);
    return res.status(500).json({ error: 'Failed to fetch student documents: ' + err.message });
  }
}

function getAllDocumentsOverview(req, res) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  const usersWithDocs = documentService.getAllDocuments();
  return res.json({
    totalUsers: usersWithDocs.length,
    users: usersWithDocs
  });
}

function getDocumentById(req, res) {
  const docId = parseInt(req.params.id, 10);
  const targetUserId = (req.user.role === 'admin' && req.query.userId) 
    ? req.query.userId 
    : req.user.id;

  const doc = documentService.getDocumentById(targetUserId, docId);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }

  return res.json(doc);
}

async function handleDocumentUpload(req, res) {
  const rawDocId = req.params.id ? parseInt(req.params.id, 10) : null;
  const requestedUserId = req.body?.userId || req.query.userId || req.body?.studentId || req.query.studentId;
  const targetUserId = (req.user.role === 'admin' && requestedUserId)
    ? requestedUserId
    : req.user.id;
  const userNotes = req.body.notes || '';
  const requestedDocType = (req.body.documentType || req.body.docType || '').trim();

  if (!req.file) {
    return res.status(400).json({ error: 'Please choose a document file to upload.' });
  }

  try {
    const result = await documentService.processDocumentUpload({
      rawDocId,
      targetUserId,
      userNotes,
      requestedDocType,
      file: req.file
    });

    if (result.error) {
      return res.status(result.status || 500).json(result);
    }

    return res.json(result);
  } catch (err) {
    console.error('[DocumentController] Upload Error:', err);
    return res.status(500).json({ error: 'Failed to process document upload: ' + err.message });
  }
}

function updateMetadata(req, res) {
  const docId = parseInt(req.params.id, 10);
  const targetUserId = req.user.id;

  try {
    const updatedDoc = documentService.updateMetadata(targetUserId, docId, req.body);
    return res.json({
      message: 'Document metadata updated successfully.',
      document: updatedDoc
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function reviewDocument(req, res) {
  const docId = parseInt(req.params.id, 10);
  const requestedUserId = req.body?.userId || req.query.userId || req.body?.studentId || req.query.studentId;
  const targetUserId = (req.user.role === 'admin' && requestedUserId)
    ? requestedUserId
    : (requestedUserId || req.user.id);

  let { approvalStatus, verificationStatus, status, rejectionReason, rejection_reason, reason, isLocked, adminFeedback, versionNumber, studentDocumentId } = req.body || {};
  if (status !== undefined && verificationStatus === undefined) {
    verificationStatus = status;
  }
  const effectiveReason = rejectionReason || rejection_reason || reason || adminFeedback;

  try {
    const updatedDoc = documentService.reviewDocument(targetUserId, docId, {
      approvalStatus,
      verificationStatus,
      rejectionReason: effectiveReason,
      isLocked,
      adminFeedback: effectiveReason,
      versionNumber,
      studentDocumentId
    });

    const statusLabel = updatedDoc.verificationStatus === 1 ? 'Approved' : (updatedDoc.verificationStatus === 2 ? 'Rejected' : 'Pending');

    return res.json({
      message: `Document verification status updated: ${statusLabel} (Code: ${updatedDoc.verificationStatus})`,
      verificationStatus: updatedDoc.verificationStatus,
      approvalStatus: updatedDoc.approvalStatus,
      document: updatedDoc
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function deleteDocument(req, res) {
  const docId = parseInt(req.params.id, 10);
  const requestedUserId = req.body?.userId || req.query.userId || req.body?.studentId || req.query.studentId;
  const targetUserId = (req.user.role === 'admin' && requestedUserId)
    ? requestedUserId
    : req.user.id;
  const versionNumber = req.query.version ? parseInt(req.query.version, 10) : undefined;

  const existingDoc = documentService.getDocumentById(targetUserId, docId);
  if (!existingDoc) {
    return res.status(404).json({ error: 'Document not found' });
  }

  if (existingDoc.isLocked && existingDoc.approvalStatus !== 'Rejected') {
    return res.status(403).json({ error: 'Cannot delete document. It is locked by compliance review.' });
  }

  try {
    const updatedDoc = await documentService.deleteDocument(targetUserId, docId, versionNumber);
    return res.json({
      message: versionNumber && (existingDoc.versions?.length || 0) > 1
        ? `Document version #${versionNumber} deleted successfully.`
        : `Document "${updatedDoc?.name || existingDoc.name}" has been deleted.`,
      document: updatedDoc
    });
  } catch (err) {
    console.error('[DocumentController] Delete error:', err);
    return res.status(500).json({ error: err.message || 'Failed to delete document.' });
  }
}

module.exports = {
  getDocuments,
  getStudentFollowupDocuments,
  getAllDocumentsOverview,
  getDocumentById,
  handleDocumentUpload,
  updateMetadata,
  reviewDocument,
  deleteDocument
};
