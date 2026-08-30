const express = require('express');
const auth = require('../middleware/auth');
const { create, getById, markClaimed } = require('../controllers/paymentRequestController');

const router = express.Router();

router.post('/', auth, create);
router.get('/:id', getById);
router.post('/:id/claim', auth, markClaimed);

module.exports = router;
