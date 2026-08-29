import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ArrowUpDown, AlertTriangle, CheckCircle2, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../utils/api';
import toast from 'react-hot-toast';

const REFRESH_INTERVAL = 15; // seconds
const HIGH_IMPACT_PCT = 2;
const PRICE_CHANGE_TOAST_THRESHOLD = 0.005; // 0.5%

const SLIPPAGE_PRESETS = [0.1, 0.5, 1.0];
const DEFAULT_SLIPPAGE = 0.5;
const SLIPPAGE_STORAGE_KEY = 'afripay_swap_slippage';

function getSavedSlippage() {
  const v = parseFloat(localStorage.getItem(SLIPPAGE_STORAGE_KEY));
  return isNaN(v) || v <= 0 ? DEFAULT_SLIPPAGE : v;
}

export default function Swap() {
  const { t } = useTranslation();
  const [sellAsset, setSellAsset] = useState('XLM');
  const [buyAsset, setBuyAsset] = useState('USDC');
  const [sellAmount, setSellAmount] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [slippage, setSlippage] = useState(getSavedSlippage);
  const [customSlippage, setCustomSlippage] = useState('');
  const [showSlippagePopover, setShowSlippagePopover] = useState(false);
  const slippagePopoverRef = useRef(null);

  const minReceived = quote?.estimatedReceived
    ? (parseFloat(quote.estimatedReceived) * (1 - slippage / 100)).toFixed(7)
    : null;

  const applySlippage = (value) => {
    const v = parseFloat(value);
    if (!isNaN(v) && v > 0 && v <= 50) {
      setSlippage(v);
      localStorage.setItem(SLIPPAGE_STORAGE_KEY, String(v));
    }
  };

  // Close slippage popover on outside click
  useEffect(() => {
    if (!showSlippagePopover) return;
    const handler = (e) => {
      if (slippagePopoverRef.current && !slippagePopoverRef.current.contains(e.target)) {
        setShowSlippagePopover(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSlippagePopover]);

  // Auto-refresh countdown (counts down from REFRESH_INTERVAL to 0)
  const [refreshCountdown, setRefreshCountdown] = useState(REFRESH_INTERVAL);
  const prevMidPriceRef = useRef(null);
  const countdownRef = useRef(null);
  const refreshIntervalRef = useRef(null);

  const flipPair = () => {
    setSellAsset(buyAsset);
    setBuyAsset(sellAsset);
    setSellAmount('');
    setQuote(null);
    setResult(null);
    prevMidPriceRef.current = null;
  };

  const fetchQuote = useCallback(async (isAutoRefresh = false) => {
    if (!sellAmount || parseFloat(sellAmount) <= 0) { setQuote(null); return; }
    setQuoteLoading(true);
    try {
      const bookRes = await api.get(`/dex/orderbook?selling=${sellAsset}&buying=${buyAsset}`);
      const { midPrice, asks } = bookRes.data;

      const bestAsk = asks[0] ? parseFloat(asks[0].price) : null;
      const estimatedReceived = bestAsk ? (parseFloat(sellAmount) / bestAsk).toFixed(7) : null;
      const bestAskVolume = asks[0] ? parseFloat(asks[0].amount) : Infinity;
      const priceImpactPct = bestAskVolume > 0
        ? Math.min(((parseFloat(sellAmount) / bestAskVolume) * 100), 100)
        : 0;

      setQuote({ midPrice, estimatedReceived, priceImpactPct });

      // Notify on significant price change during auto-refresh
      if (isAutoRefresh && prevMidPriceRef.current !== null && midPrice) {
        const change = Math.abs((midPrice - prevMidPriceRef.current) / prevMidPriceRef.current);
        if (change > PRICE_CHANGE_TOAST_THRESHOLD) {
          toast('Price updated', {
            icon: '🔄',
            style: { background: '#1e293b', color: '#e2e8f0' },
            duration: 2500,
          });
        }
      }
      if (midPrice) prevMidPriceRef.current = midPrice;
    } catch {
      setQuote(null);
    } finally {
      setQuoteLoading(false);
    }
  }, [sellAsset, buyAsset, sellAmount]);

  // Debounce on user input
  useEffect(() => {
    const t = setTimeout(() => fetchQuote(false), 500);
    return () => clearTimeout(t);
  }, [fetchQuote]);

  // Start/stop the 15s auto-refresh cycle; pause when confirm modal is open
  useEffect(() => {
    if (confirmOpen) {
      clearInterval(refreshIntervalRef.current);
      clearInterval(countdownRef.current);
      return;
    }

    setRefreshCountdown(REFRESH_INTERVAL);

    // Countdown ticker (1s)
    countdownRef.current = setInterval(() => {
      setRefreshCountdown(prev => (prev <= 1 ? REFRESH_INTERVAL : prev - 1));
    }, 1000);

    // Auto-refresh trigger
    refreshIntervalRef.current = setInterval(() => {
      fetchQuote(true);
      setRefreshCountdown(REFRESH_INTERVAL);
    }, REFRESH_INTERVAL * 1000);

    return () => {
      clearInterval(refreshIntervalRef.current);
      clearInterval(countdownRef.current);
    };
  }, [confirmOpen, fetchQuote]);

  const handleManualRefresh = () => {
    fetchQuote(false);
    setRefreshCountdown(REFRESH_INTERVAL);
    // Reset the auto-refresh interval so it restarts from now
    clearInterval(refreshIntervalRef.current);
    clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setRefreshCountdown(prev => (prev <= 1 ? REFRESH_INTERVAL : prev - 1));
    }, 1000);
    refreshIntervalRef.current = setInterval(() => {
      fetchQuote(true);
      setRefreshCountdown(REFRESH_INTERVAL);
    }, REFRESH_INTERVAL * 1000);
  };

  const handleSwap = async (e) => {
    e.preventDefault();
    if (!confirmOpen) { setConfirmOpen(true); return; }
    setSubmitting(true);
    setResult(null);
    try {
      const res = await api.post('/dex/swap', {
        sell_asset: sellAsset,
        sell_amount: parseFloat(sellAmount),
        buy_asset: buyAsset,
        min_received: minReceived ? parseFloat(minReceived) : undefined,
      });
      setResult(res.data);
      setSellAmount('');
      setQuote(null);
      prevMidPriceRef.current = null;
      toast.success('Swap executed successfully');
    } catch (err) {
      const errCode = err.response?.data?.code;
      if (errCode === 'PRICE_MOVED' || errCode === 'SLIPPAGE_EXCEEDED') {
        toast.error('Price moved too much. Increase your slippage tolerance and try again.');
      } else {
        toast.error(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Swap failed');
      }
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  };

  const highImpact = quote && quote.priceImpactPct >= HIGH_IMPACT_PCT;
  const progressPct = ((REFRESH_INTERVAL - refreshCountdown) / REFRESH_INTERVAL) * 100;

  return (
    <div className="px-4 py-6 max-w-lg mx-auto space-y-5">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{t('swap.title')}</h2>

      {/* Rate display with slippage settings */}
      <div className="bg-primary-500/10 border border-primary-500/20 rounded-xl px-4 py-2.5 flex items-center justify-between text-sm">
        <span className="text-gray-500 dark:text-gray-400">
          {quote?.midPrice
            ? `1 ${sellAsset} ≈ ${(1 / quote.midPrice).toFixed(6)} ${buyAsset}`
            : t('swap.dex_rate')}
        </span>
        <div className="relative" ref={slippagePopoverRef}>
          <button
            type="button"
            onClick={() => setShowSlippagePopover((v) => !v)}
            className="flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-primary-500 transition-colors"
            aria-label="Slippage tolerance settings"
          >
            <Settings size={14} />
            <span className="font-medium">{slippage}%</span>
          </button>

          {showSlippagePopover && (
            <div className="absolute right-0 top-8 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 w-56 shadow-xl space-y-3">
              <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                {t('swap.slippage_tolerance')}
              </p>
              <div className="flex gap-2">
                {SLIPPAGE_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => { applySlippage(p); setCustomSlippage(''); }}
                    className={`flex-1 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                      slippage === p && !customSlippage
                        ? 'border-primary-500 bg-primary-500/10 text-primary-500'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-primary-400'
                    }`}
                  >
                    {p}%
                  </button>
                ))}
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">{t('swap.custom')}</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0.01"
                    max="50"
                    step="0.1"
                    placeholder="0.5"
                    value={customSlippage}
                    onChange={(e) => {
                      setCustomSlippage(e.target.value);
                      if (e.target.value) applySlippage(e.target.value);
                    }}
                    className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-500">%</span>
                </div>
              </div>
              {slippage > 5 && (
                <p className="text-xs text-yellow-500">
                  {t('swap.high_slippage_warning')}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <form onSubmit={handleSwap} className="space-y-3">
        {/* Sell */}
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-4 space-y-2">
          <label className="text-xs text-gray-500 uppercase tracking-wide">{t('swap.you_sell')}</label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min="0"
              step="any"
              required
              placeholder="0.00"
              value={sellAmount}
              onChange={e => { setSellAmount(e.target.value); setResult(null); }}
              className="flex-1 bg-transparent text-2xl font-bold text-gray-900 dark:text-white outline-none placeholder-gray-300 dark:placeholder-gray-700"
            />
            <span className="text-lg font-semibold text-gray-700 dark:text-gray-300 shrink-0">{sellAsset}</span>
          </div>
        </div>

        {/* Flip button */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={flipPair}
            className="w-9 h-9 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full flex items-center justify-center text-gray-500 hover:text-primary-500 transition-colors shadow-sm"
            aria-label="Flip pair"
          >
            <ArrowUpDown size={16} />
          </button>
        </div>

        {/* Buy */}
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-4 space-y-2">
          <label className="text-xs text-gray-500 uppercase tracking-wide">{t('swap.you_receive_est')}</label>
          <div className="flex items-center gap-3">
            <span className="flex-1 text-2xl font-bold text-gray-400 dark:text-gray-600">
              {quoteLoading ? '…' : quote?.estimatedReceived ?? '0.00'}
            </span>
            <span className="text-lg font-semibold text-gray-700 dark:text-gray-300 shrink-0">{buyAsset}</span>
          </div>
          {minReceived && (
            <p className="text-xs text-gray-500">
              {t('swap.minimum_received', { amount: minReceived, asset: buyAsset, slippage })}
            </p>
          )}
        </div>

        {highImpact && (
          <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3 text-sm text-yellow-500">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>
              {t('swap.high_price_impact', { pct: quote.priceImpactPct.toFixed(1) })}
            </span>
          </div>
        )}

        {/* Confirm step */}
        {confirmOpen && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3 text-sm text-yellow-400">
            <p className="font-semibold mb-1">{t('swap.confirm_swap')}</p>
            <p>{t('swap.confirm_swap_detail', { sellAmount, sellAsset, estimatedReceived: quote?.estimatedReceived, buyAsset })}</p>
            <p className="text-xs text-gray-400 mt-1">{t('swap.price_locked')}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !sellAmount || parseFloat(sellAmount) <= 0}
          className="w-full bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white font-semibold py-3.5 rounded-2xl transition-colors"
        >
          {submitting ? t('swap.swapping') : confirmOpen ? t('swap.confirm_swap_button') : t('swap.swap_button', { sellAsset, buyAsset })}
        </button>

        {confirmOpen && (
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            className="w-full text-gray-400 hover:text-white text-sm py-2 transition-colors"
          >
            {t('common.cancel')}
          </button>
        )}
      </form>

      {/* Success result */}
      {result && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-4 space-y-1">
          <div className="flex items-center gap-2 text-green-400 font-semibold text-sm mb-2">
            <CheckCircle2 size={16} /> {t('swap.swap_complete')}
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t('swap.sold', { amount: result.soldAmount, asset: result.soldAsset })}
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t('swap.est_received', { amount: result.estimatedReceived, asset: result.buyAsset })}
          </p>
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${result.transactionHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary-400 hover:underline break-all"
          >
            {result.transactionHash}
          </a>
        </div>
      )}
    </div>
  );
}
