import { API_BASE } from '../apiBase';

import { useState, useCallback, useRef, useEffect } from 'react';
import { INITIAL_ADMIN_MESSAGES } from './adminData';

// Separate from the resident session id — this is a different role/agent entirely
// (see agent/admin_agent.py). Same "not real auth" caveat as resident unit context.
const ADMIN_SESSION_ID_KEY = 'spoton_admin_session_id';
const adminSessionId = sessionStorage.getItem(ADMIN_SESSION_ID_KEY) || crypto.randomUUID();
sessionStorage.setItem(ADMIN_SESSION_ID_KEY, adminSessionId);

let msgId = 20;
const nextId = () => ++msgId;
const now = () => new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });

export function useAdminDemo() {
  // Real backend space data — the exact same endpoint the Resident Portal uses, so
  // the admin site plan shows the same live state, not a separate fake copy.
  const [spaces, setSpaces] = useState([]);
  const [messages,     setMessages]     = useState(INITIAL_ADMIN_MESSAGES);
  const [isTyping,     setIsTyping]     = useState(false);
  // Real, backend-persisted vehicle reports (spoton-vehicle-reports table).
  const [vehicleReports, setVehicleReports] = useState([]);
  const [reportActionId, setReportActionId] = useState(null);
  const [selectedSpace, setSelectedSpace] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const notifId = useRef(0);

  const fetchSpaces = useCallback(() => {
    fetch(`${API_BASE}/api/parking-spaces`)
      .then(res => res.json())
      .then(data => setSpaces(data.spaces || []))
      .catch(err => console.error('Failed to fetch parking spaces:', err));
  }, []);

  const fetchVehicleReports = useCallback(() => {
    fetch(`${API_BASE}/api/admin/vehicle-reports`)
      .then(res => res.json())
      .then(data => setVehicleReports(data.reports || []))
      .catch(err => console.error('Failed to fetch vehicle reports:', err));
  }, []);

  useEffect(() => { fetchSpaces(); fetchVehicleReports(); }, [fetchSpaces, fetchVehicleReports]);

  // ── helpers ──────────────────────────────────────────────────────────────────
  const addMsg = useCallback((role, text, extra = {}) => {
    setMessages(prev => [...prev, { id: nextId(), role, text, ts: now(), ...extra }]);
  }, []);

  const agentReply = useCallback((text, delay = 1100, extra = {}) => {
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      setMessages(prev => [...prev, { id: nextId(), role: 'agent', text, ts: now(), ...extra }]);
    }, delay);
  }, []);

  const pushNotif = useCallback((type, title, body) => {
    const id = ++notifId.current;
    setNotifications(prev => [...prev, { id, type, title, body }]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 7000);
  }, []);

  // ── send message ──────────────────────────────────────────────────────────────
  const sendMessage = useCallback((text) => {
    if (!text.trim()) return;
    addMsg('admin', text);

    // ── Vehicle report/lookup — every message goes to the real admin agent ─────
    // Deliberately not keyword-gated: a bare plate with a space in it ("XYZ 999"), a
    // reply like "yes, I have one", or the space mentioned before the plate would all
    // miss a keyword/regex gate but are still valid report messages — the agent itself
    // (see agent/admin_agent.py) decides whether to ask a clarifying question or proceed.
    setIsTyping(true);
    fetch(`${API_BASE}/api/admin/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, session_id: adminSessionId }),
    })
      .then(res => res.json())
      .then(data => {
        setIsTyping(false);
        addMsg('agent', data.message);
        fetchVehicleReports();
        fetchSpaces();
      })
      .catch(() => {
        setIsTyping(false);
        addMsg('agent', "Sorry, I couldn't reach the SpotOn server. Please try again.");
      });
  }, [addMsg, fetchVehicleReports, fetchSpaces]);

  // ── quick actions ─────────────────────────────────────────────────────────────
  const triggerQuickAction = useCallback((action) => {
    switch (action) {
      case 'vehicles': {
        addMsg('admin', 'Show vehicles requiring review.');
        const pending = vehicleReports.filter(r => r.status === 'requires_review').length;
        agentReply(
          pending > 0
            ? `There ${pending === 1 ? 'is' : 'are'} currently ${pending} vehicle report${pending === 1 ? '' : 's'} requiring review — they're flagged on the site plan.`
            : "There are no vehicle reports requiring review right now.",
          900,
        );
        break;
      }
      default:
        break;
    }
  }, [vehicleReports, addMsg, agentReply]);

  // ── vehicle review decision — real backend calls, deterministic (no agent) ────
  const markExpected = useCallback((reportId) => {
    if (reportActionId) return;
    setReportActionId(reportId);
    fetch(`${API_BASE}/api/admin/vehicle-reports/${reportId}/expected`, { method: 'POST' })
      .then(res => res.json().then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        setReportActionId(null);
        if (!ok) {
          pushNotif('error', 'Action failed', data.detail || 'Could not update the report. Please try again.');
          return;
        }
        pushNotif('success', 'Marked as expected', 'Decision recorded. The space reopens once no reports need review.');
        fetchVehicleReports();
        fetchSpaces();
      })
      .catch(() => {
        setReportActionId(null);
        pushNotif('error', 'Action failed', "Sorry, I couldn't reach the SpotOn server. Please try again.");
      });
  }, [reportActionId, pushNotif, fetchVehicleReports, fetchSpaces]);

  const reportToSecurity = useCallback((reportId) => {
    if (reportActionId) return;
    setReportActionId(reportId);
    fetch(`${API_BASE}/api/admin/vehicle-reports/${reportId}/notify-security`, { method: 'POST' })
      .then(res => res.json().then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        setReportActionId(null);
        if (!ok) {
          pushNotif('error', 'Action failed', data.detail || 'Could not notify security. Please try again.');
          return;
        }
        pushNotif(
          data.security_email_sent ? 'success' : 'error',
          data.security_email_sent ? 'Security notified' : 'Report saved — email failed',
          data.message,
        );
        fetchVehicleReports();
        fetchSpaces();
      })
      .catch(() => {
        setReportActionId(null);
        pushNotif('error', 'Action failed', "Sorry, I couldn't reach the SpotOn server. Please try again.");
      });
    }, [reportActionId, pushNotif, fetchVehicleReports, fetchSpaces]);

  return {
    spaces, messages, isTyping, vehicleReports, reportActionId,
    selectedSpace, notifications,
    setSelectedSpace,
    sendMessage, triggerQuickAction, markExpected, reportToSecurity,
    dismissNotif: (id) => setNotifications(prev => prev.filter(n => n.id !== id)),
  };
}
