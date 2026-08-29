const cron = require('node-cron');
const checkClaimableBalanceExpiry = require('./checkClaimableBalanceExpiry');
const { run: runPaymentRequestCleanup } = require('./paymentRequestCleanupJob');
const logger = require('../utils/logger');

const CLEANUP_CRON = process.env.PAYMENT_REQUEST_CLEANUP_CRON || '0 2 * * *';

function startScheduler() {
  cron.schedule('0 9 * * *', async () => {
    logger.info('Running scheduled claimable balance expiry check');
    await checkClaimableBalanceExpiry();
  });

  cron.schedule(CLEANUP_CRON, async () => {
    logger.info('Running payment request cleanup job');
    await runPaymentRequestCleanup().catch((err) =>
      logger.error('payment_request_cleanup error', { error: err.message })
    );
  });

  logger.info('Job scheduler started');
}

module.exports = { startScheduler };
