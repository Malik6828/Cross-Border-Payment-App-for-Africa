const router = require('express').Router();
const authMiddleware = require('../middleware/auth');
const { create, list, listDeliveries, retry, rotateSecret } = require('../controllers/webhookController');
const { create, update, list, listDeliveries, retry } = require('../controllers/webhookController');

router.use(authMiddleware);

router.post('/', create);
router.put('/:id', update);
router.get('/', list);
router.get('/deliveries', listDeliveries);
router.post('/deliveries/:id/retry', retry);
router.post('/:id/rotate-secret', rotateSecret);

module.exports = router;
