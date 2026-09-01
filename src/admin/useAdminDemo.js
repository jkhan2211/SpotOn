import { useState, useCallback, useRef, useEffect } from 'react';
import {
  INITIAL_WAITLIST,
  INITIAL_ACTIVITY, INITIAL_ADMIN_MESSAGES, ADMIN_STATUS, POLICIES,
} from './adminData';

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
  // Real, backend-persisted vehicle reports (unknown_vehicle.csv) — unlike the rest of
  // this admin dashboard's mock waitlist/activity, this part is wired for real.
  const [vehicleReports, setVehicleReports] = useState([]);
  const [reportActionId, setReportActionId] = useState(null);
  const [waitlist]                      = useState(INITIAL_WAITLIST);
  const [activity,     setActivity]     = useState(INITIAL_ACTIVITY);
  const [selectedSpace, setSelectedSpace] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const notifId = useRef(0);

  const fetchSpaces = useCallback(() => {
    fetch('http://localhost:8000/api/parking-spaces')
      .then(res => res.json())
      .then(data => setSpaces(data.spaces || []))
      .catch(err => console.error('Failed to fetch parking spaces:', err));
  }, []);

  const fetchVehicleReports = useCallback(() => {
    fetch('http://localhost:8000/api/admin/vehicle-reports')
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

  const logActivity = useCallback((text, source = 'Admin') => {
    setActivity(prev => [{ ts: now(), text, source }, ...prev]);
  }, []);

  // ── send message ──────────────────────────────────────────────────────────────
  const sendMessage = useCallback((text) => {
    if (!text.trim()) return;
    addMsg('admin', text);
    const lower = text.toLowerCase();

    // ── Scenario 6: capacity query ────────────────────────────────────────────
    if (lower.includes('full') || lower.includes('capacity') || lower.includes('available') || lower.includes('how many')) {
      const allocated = spaces.filter(s => s.status !== ADMIN_STATUS.AVAILABLE).length;
      agentReply(`${allocated} of 12 visitor spaces are currently allocated. There are ${waitlist.length} pending requests on the waitlist.`, 900);
      return;
    }

    // ── Scenario 7: waitlist ──────────────────────────────────────────────────
    if (lower.includes('waitlist') || lower.includes('waiting')) {
      agentReply('Here are the current waitlisted requests:', 800, { waitlistData: waitlist });
      return;
    }

    // ── Scenario 8: recent activity ───────────────────────────────────────────
    if (lower.includes('recent') || lower.includes('activity') || lower.includes('done') || lower.includes('actions') || lower.includes('log')) {
      agentReply('Here is a summary of recent SpotOn activity:', 800, { activityFeed: activity.slice(0, 6) });
      return;
    }

    // ── Scenario 9: policy ────────────────────────────────────────────────────
    if (lower.includes('policy') || lower.includes('no-show') || lower.includes('noshow') || lower.includes('grace') || lower.includes('rule')) {
      const key = lower.includes('extension') ? 'extension' : lower.includes('visitor') ? 'visitor' : lower.includes('temp') ? 'temp' : 'noshow';
      agentReply(POLICIES[key], 900, { policyCard: { key, text: POLICIES[key] } });
      return;
    }

    // ── Default: vehicle report/lookup — hits the real admin backend ───────────
    // This is deliberately the fallback, not a keyword-gated branch: a bare plate with
    // a space in it ("XYZ 999"), a reply like "yes, I have one", or the space mentioned
    // before the plate would all miss a keyword/regex gate but are still valid report
    // messages — the agent itself (see agent/admin_agent.py) is what should decide
    // whether to ask a clarifying question or proceed, not a scripted string match.
    setIsTyping(true);
    fetch('http://localhost:8000/api/admin/chat', {
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
  }, [spaces, waitlist, activity, addMsg, agentReply, fetchVehicleReports, fetchSpaces]);

  // ── quick actions ─────────────────────────────────────────────────────────────
  const triggerQuickAction = useCallback((action) => {
    switch (action) {
      case 'vehicles': {
        addMsg('admin', 'Show vehicles requiring review.');
        const pending = vehicleReports.filter(r => r.status === 'requires_review').length;
        agentReply(
          pending > 0
            ? `There ${pending === 1 ? 'is' : 'are'} currently ${pending} vehicle report${pending === 1 ? '' : 's'} requiring review — see the Vehicle Review card above.`
            : "There are no vehicle reports requiring review right now.",
          900,
        );
        break;
      }
      case 'capacity':
        addMsg('admin', 'Show current capacity.');
        sendMessage('How full is visitor parking right now?');
        break;
      case 'waitlist':
        addMsg('admin', 'Show the waitlist.');
        agentReply('Here are the current waitlisted requests:', 800, { waitlistData: waitlist });
        break;
      case 'activity':
        addMsg('admin', 'Show recent agent actions.');
        agentReply('Here is a summary of recent SpotOn activity:', 800, { activityFeed: activity.slice(0, 6) });
        break;
      case 'policy':
        addMsg('admin', 'What is the current no-show policy?');
        agentReply(POLICIES.noshow, 900, { policyCard: { key: 'noshow', text: POLICIES.noshow } });
        break;
      default:
        break;
    }
  }, [vehicleReports, waitlist, activity, addMsg, agentReply, sendMessage]);

  // ── vehicle review decision — real backend calls, deterministic (no agent) ────
  const markExpected = useCallback((reportId) => {
    if (reportActionId) return;
    setReportActionId(reportId);
    fetch(`http://localhost:8000/api/admin/vehicle-reports/${reportId}/expected`, { method: 'POST' })
      .then(res => res.json().then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        setReportActionId(null);
        if (!ok) {
          pushNotif('error', 'Action failed', data.detail || 'Could not update the report. Please try again.');
          return;
        }
        const report = vehicleReports.find(r => r.report_id === reportId);
        logActivity(`${report?.plate ?? reportId} — Marked Expected by administrator.`, 'Admin');
        pushNotif('success', 'Marked as expected', 'Decision recorded — the space remains unavailable to residents.');
        fetchVehicleReports();
      })
      .catch(() => {
        setReportActionId(null);
        pushNotif('error', 'Action failed', "Sorry, I couldn't reach the SpotOn server. Please try again.");
      });
  }, [reportActionId, vehicleReports, pushNotif, logActivity, fetchVehicleReports]);

  const reportToSecurity = useCallback((reportId) => {
    if (reportActionId) return;
    setReportActionId(reportId);
    fetch(`http://localhost:8000/api/admin/vehicle-reports/${reportId}/notify-security`, { method: 'POST' })
      .then(res => res.json().then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        setReportActionId(null);
        if (!ok) {
          pushNotif('error', 'Action failed', data.detail || 'Could not notify security. Please try again.');
          return;
        }
        const report = vehicleReports.find(r => r.report_id === reportId);
        logActivity(`${report?.plate ?? reportId} — Reported to Security by administrator.`, 'Admin');
        pushNotif(
          data.security_email_sent ? 'success' : 'error',
          data.security_email_sent ? 'Security notified' : 'Report saved — email failed',
          data.message,
        );
        fetchVehicleReports();
      })
      .catch(() => {
        setReportActionId(null);
        pushNotif('error', 'Action failed', "Sorry, I couldn't reach the SpotOn server. Please try again.");
      });
  }, [reportActionId, vehicleReports, pushNotif, logActivity, fetchVehicleReports]);

  return {
    spaces, messages, isTyping, vehicleReports, reportActionId, waitlist, activity,
    selectedSpace, notifications,
    setSelectedSpace,
    sendMessage, triggerQuickAction, markExpected, reportToSecurity,
    dismissNotif: (id) => setNotifications(prev => prev.filter(n => n.id !== id)),
  };
}
