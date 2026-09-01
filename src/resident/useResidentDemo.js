import { useState, useCallback, useRef, useEffect } from 'react';
import { INITIAL_SPACES, INITIAL_MESSAGES, STATUS, SCENARIO } from './residentData';

// One id per browser tab/session — not real auth, just how the backend knows which
// resident-context + conversation belongs to this tab. Persists across reloads of the
// same tab (sessionStorage); clearing it (see switchUnit()) starts a fresh identity.
const SESSION_ID_KEY = 'spoton_session_id';
const sessionId = sessionStorage.getItem(SESSION_ID_KEY) || crypto.randomUUID();
sessionStorage.setItem(SESSION_ID_KEY, sessionId);

// Browser-reported IANA timezone (e.g. "America/Toronto") — residents state times in
// their own local clock ("7 PM"), so the backend needs to know which "7 PM" that is
// to convert it to UTC correctly instead of assuming the server's UTC clock.
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

let msgId = 10;
const nextId = () => ++msgId;
const now = () => {
  const d = new Date();
  return d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
};
const formatTime = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
};

export function useResidentDemo() {
  const [spaces, setSpaces] = useState(INITIAL_SPACES);
  const [messages, setMessages]       = useState(INITIAL_MESSAGES);
  const [scenario, setScenario]       = useState(SCENARIO.IDLE);
  // Keyed by space id — a resident can have more than one active permit at once
  // (e.g. a visitor booking and a temporary-resident booking in different spaces).
  const [activePermits, setActivePermits] = useState({});
  const soleActivePermit = Object.keys(activePermits).length === 1 ? Object.values(activePermits)[0] : null;
  const [waitlistItem, setWaitlistItem] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [selectedSpace, setSelectedSpace] = useState(null);
  const [isTyping, setIsTyping]       = useState(false);
  const [isReleasing, setIsReleasing] = useState(false);
  const [offers, setOffers] = useState([]);
  const [offerActionId, setOfferActionId] = useState(null);
  const [residentContext, setResidentContext] = useState(null);
  const pendingVisitor = useRef('');
  const notifId = useRef(0);

  // ── fetch spaces from backend ─────────────────────────────────────────────
  const fetchSpaces = useCallback(() => {
    fetch('http://localhost:8000/api/parking-spaces')
      .then(res => res.json())
      .then(data => setSpaces(data.spaces))
      .catch(err => console.error('Failed to fetch parking spaces:', err));
  }, []);

  // ── fetch active waitlist offers — no push/polling infra, so this runs at the same
  // natural sync points as fetchSpaces (mount, after chat, after release/accept/decline) ──
  const fetchOffers = useCallback(() => {
    fetch(`http://localhost:8000/api/waitlist/offers?session_id=${encodeURIComponent(sessionId)}`)
      .then(res => res.json())
      .then(data => setOffers(data.offers || []))
      .catch(err => console.error('Failed to fetch waitlist offers:', err));
  }, []);

  // ── switch unit — start a fresh resident identity for this tab ─────────────
  const switchUnit = useCallback(() => {
    sessionStorage.removeItem(SESSION_ID_KEY);
    window.location.reload();
  }, []);

  useEffect(() => { fetchSpaces(); fetchOffers(); }, [fetchSpaces, fetchOffers]);

  // ── helpers ──────────────────────────────────────────────────────────────────
  const addMsg = useCallback((role, text, extra = {}) => {
    setMessages(prev => [...prev, { id: nextId(), role, text, ts: now(), ...extra }]);
  }, []);

  const agentReply = useCallback((text, delay = 1200, extra = {}) => {
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

  const updateSpace = useCallback((spaceId, patch) => {
    setSpaces(prev => prev.map(s => s.id === spaceId ? { ...s, ...patch } : s));
  }, []);

  // ── release/cancel an active permit — real backend call ─────────────────────
  const releasePermit = useCallback((spaceId) => {
    // Prefer the backend's own record of what's parked here (works even if this
    // browser session didn't create the permit itself); fall back to the locally
    // tracked map for the deferred, fully-scripted temp-parking demo path.
    const space = spaces.find(s => s.id === spaceId);
    const permitId = space?.current_permit_id || activePermits[spaceId]?.permitId;
    if (!permitId || isReleasing) return;
    setIsReleasing(true);
    fetch(`http://localhost:8000/api/permits/${permitId}/release`, { method: 'POST' })
      .then(res => res.json().then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        setIsReleasing(false);
        if (!ok) {
          pushNotif('error', 'Release failed', data.detail || 'Could not release the space. Please try again.');
          return;
        }
        addMsg('agent', data.message);
        pushNotif('released', `${data.space_id} has been released`, `Permit ${data.permit_id} is now ${data.permit_status}`);
        setActivePermits(prev => {
          const next = { ...prev };
          delete next[spaceId];
          return next;
        });
        if (Object.keys(activePermits).length <= 1) setScenario(SCENARIO.IDLE);
        fetchSpaces();
        fetchOffers();
      })
      .catch(() => {
        setIsReleasing(false);
        pushNotif('error', 'Release failed', "Sorry, I couldn't reach the SpotOn server. Please try again.");
      });
  }, [spaces, activePermits, isReleasing, addMsg, pushNotif, fetchSpaces, fetchOffers]);

  // ── accept/decline a waitlist offer — real backend calls, deterministic (no agent) ──
  const acceptOffer = useCallback((waitlistId) => {
    if (offerActionId) return;
    setOfferActionId(waitlistId);
    fetch(`http://localhost:8000/api/waitlist/${waitlistId}/accept`, { method: 'POST' })
      .then(res => res.json().then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        setOfferActionId(null);
        if (!ok) {
          pushNotif('error', 'Accept failed', data.detail || 'Could not accept the offer. Please try again.');
          return;
        }
        addMsg('agent', data.message);
        const permit = {
          visitor: data.visitor_name,
          plate: data.visitor_plate,
          space: data.space_id,
          from: formatTime(data.start_time),
          until: formatTime(data.end_time),
          status: 'Upcoming',
          permitId: data.permit_id,
        };
        setActivePermits(prev => ({ ...prev, [permit.space]: permit }));
        setScenario(SCENARIO.BOOKING_CONFIRMED);
        pushNotif('success', 'Parking confirmed', `${permit.visitor} — Space ${permit.space}, ${permit.from}–${permit.until}`);
        fetchSpaces();
        fetchOffers();
      })
      .catch(() => {
        setOfferActionId(null);
        pushNotif('error', 'Accept failed', "Sorry, I couldn't reach the SpotOn server. Please try again.");
      });
  }, [offerActionId, addMsg, pushNotif, fetchSpaces, fetchOffers]);

  const declineOffer = useCallback((waitlistId) => {
    if (offerActionId) return;
    setOfferActionId(waitlistId);
    fetch(`http://localhost:8000/api/waitlist/${waitlistId}/decline`, { method: 'POST' })
      .then(res => res.json().then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        setOfferActionId(null);
        if (!ok) {
          pushNotif('error', 'Decline failed', data.detail || 'Could not decline the offer. Please try again.');
          return;
        }
        pushNotif('info', 'Offer declined', data.message);
        fetchSpaces();
        fetchOffers();
      })
      .catch(() => {
        setOfferActionId(null);
        pushNotif('error', 'Decline failed', "Sorry, I couldn't reach the SpotOn server. Please try again.");
      });
  }, [offerActionId, pushNotif, fetchSpaces, fetchOffers]);

  // ── send handler ─────────────────────────────────────────────────────────────
  const sendMessage = useCallback((text) => {
    if (!text.trim()) return;
    addMsg('resident', text);
    const lower = text.toLowerCase();

    // ── Scenario 1: normal booking — routed to the real backend (see fallback below) ──
    if (scenario === SCENARIO.IDLE) {
      if (lower.includes('contractor') || lower.includes('blocking') || lower.includes('temporary') || lower.includes('temp')) {
        setScenario(SCENARIO.TEMP_PARKING);
        agentReply("I'll check the temporary resident parking policy and current capacity...", 800, { processing: true });
        setTimeout(() => {
          setIsTyping(false);
          agentReply("Temporary resident parking has been approved until 6:00 PM in space V04.", 2400);
          updateSpace('V04', { status: STATUS.RESERVED, ownerUnit: '14', visitor: 'Contractor', permit: 'SP-TEMP-01', until: '6:00 PM' });
          setActivePermits(prev => ({ ...prev, V04: { type: 'temp', visitor: 'Contractor', space: 'V04', from: 'Now', until: '6:00 PM', plate: '—', status: 'Active' } }));
          setScenario(SCENARIO.TEMP_CONFIRMED);
          pushNotif('success', 'Temporary parking approved', 'Space V04 reserved until 6:00 PM');
        }, 2600);
        return;
      }
      if (lower.includes('7') && lower.includes('11')) {
        setScenario(SCENARIO.ALT_TIME);
        agentReply("The full 7–11 PM window isn't currently available. I found two compatible alternatives:", 1100, { alternatives: ['6:00–8:00 PM', '9:30–11:30 PM'] });
        return;
      }
    }

    // ── Scenario 5: extension ───────────────────────────────────────────────
    if (scenario === SCENARIO.BOOKING_CONFIRMED && (lower.includes('extend') || lower.includes('two more') || lower.includes('another hour') || lower.includes('longer'))) {
      setScenario(SCENARIO.EXTENSION_REQUEST);
      agentReply("Checking extension policy and future parking availability...", 700, { processing: true });
      setTimeout(() => {
        setIsTyping(false);
        setMessages(prev => [...prev, {
          id: nextId(), role: 'agent', ts: now(),
          text: "I can't extend the permit until 7:00 PM because the space is committed later. I can extend it until 5:30 PM.",
          extensionOptions: ['5:30 PM'],
        }]);
        setScenario(SCENARIO.EXTENSION_CONFLICT);
      }, 2200);
      return;
    }

    // ── Scenario 7: alternative time ────────────────────────────────────────
    if (scenario === SCENARIO.ALT_TIME) {
      setScenario(SCENARIO.IDLE);
      agentReply("Got it! I'll book that window for you. You'll receive a confirmation shortly.", 900);
      return;
    }

    // ── fallback — hits real FastAPI backend ────────────────────────────────
    setIsTyping(true);
    fetch('http://localhost:8000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, session_id: sessionId, timezone }),
    })
      .then(res => res.json())
      .then(data => {
        setIsTyping(false);
        addMsg('agent', data.message);
        if (data.resident) setResidentContext(data.resident);
        if (data.permit) {
          const p = data.permit;
          const permit = {
            visitor: p.visitor_name,
            plate: p.visitor_plate,
            space: p.space_id,
            from: formatTime(p.start_time),
            until: formatTime(p.end_time),
            status: 'Upcoming',
            permitId: p.permit_id,
          };
          setActivePermits(prev => ({ ...prev, [permit.space]: permit }));
          setScenario(SCENARIO.BOOKING_CONFIRMED);
          updateSpace(permit.space, { status: STATUS.RESERVED, ownerUnit: data.resident?.unit_number, visitor: permit.visitor, permit: permit.permitId, until: permit.until });
          pushNotif('success', 'Visitor parking confirmed', `${permit.visitor} — Space ${permit.space}, ${permit.from}–${permit.until}`);
        }
        fetchSpaces();
        fetchOffers();
      })
      .catch(() => {
        setIsTyping(false);
        addMsg('agent', "Sorry, I couldn't reach the SpotOn server. Please try again.");
      });
  }, [scenario, addMsg, agentReply, pushNotif, updateSpace, fetchSpaces, fetchOffers]);

  // ── quick actions ─────────────────────────────────────────────────────────
  const triggerQuickAction = useCallback((action) => {
    switch (action) {
      case 'book':
        sendMessage('My brother Alex is coming from 2–5 PM.');
        break;
      case 'release':
        if (soleActivePermit) {
          addMsg('resident', `${soleActivePermit.visitor} left early.`);
          releasePermit(soleActivePermit.space);
        } else if (Object.keys(activePermits).length > 1) {
          addMsg('resident', 'I need to release a parking space.');
          agentReply("You have more than one active booking right now — click the specific space on the site plan to release it.", 800);
        } else {
          addMsg('resident', 'I need to release a parking space.');
          agentReply("I don't see an active permit to release. Let me know the space or visitor name.", 800);
        }
        break;
      case 'extend':
        if (soleActivePermit) {
          addMsg('resident', `${soleActivePermit.visitor} needs another two hours.`);
          setScenario(SCENARIO.EXTENSION_REQUEST);
          agentReply("Checking extension policy and future parking availability...", 700, { processing: true });
          setTimeout(() => {
            setIsTyping(false);
            setMessages(prev => [...prev, {
              id: nextId(), role: 'agent', ts: now(),
              text: "I can't extend the permit until 7:00 PM because the space is committed later. I can extend it until 5:30 PM.",
              extensionOptions: ['5:30 PM'],
            }]);
            setScenario(SCENARIO.EXTENSION_CONFLICT);
          }, 2200);
        } else {
          addMsg('resident', 'I need to extend a parking permit.');
          agentReply("I don't see an active permit to extend. Book a visitor first.", 800);
        }
        break;
      case 'temp':
        addMsg('resident', 'My contractor is blocking my driveway until 6 PM. Can I use visitor parking?');
        setScenario(SCENARIO.TEMP_PARKING);
        agentReply("I'll check the temporary resident parking policy and current capacity...", 800, { processing: true });
        setTimeout(() => {
          setIsTyping(false);
          agentReply("Temporary resident parking has been approved until 6:00 PM in space V04.", 2400);
          updateSpace('V04', { status: STATUS.RESERVED, ownerUnit: '14', visitor: 'Contractor', permit: 'SP-TEMP-01', until: '6:00 PM' });
          setActivePermits(prev => ({ ...prev, V04: { type: 'temp', visitor: 'Contractor', space: 'V04', from: 'Now', until: '6:00 PM', plate: '—', status: 'Active' } }));
          setScenario(SCENARIO.TEMP_CONFIRMED);
          pushNotif('success', 'Temporary parking approved', 'Space V04 reserved until 6:00 PM');
        }, 2600);
        break;
      case 'noshow':
        setMessages(prev => [...prev, {
          id: nextId(), role: 'agent', ts: now(),
          text: 'Alex is expected at 4:00 PM. Is he still coming?',
          noshowPrompt: true,
        }]);
        setScenario(SCENARIO.NOSHOW_REMINDER);
        break;
      default:
        break;
    }
  }, [soleActivePermit, activePermits, addMsg, agentReply, pushNotif, updateSpace, sendMessage, releasePermit]);

  // ── waitlist join ─────────────────────────────────────────────────────────
  const joinWaitlist = useCallback(() => {
    setWaitlistItem({ visitor: pendingVisitor.current || 'Visitor', from: '2:00 PM', until: '5:00 PM', status: 'Waiting' });
    setScenario(SCENARIO.WAITLISTED);
    agentReply("You're on the waitlist. I'll notify you as soon as a compatible space becomes available.", 600);
    pushNotif('info', 'Added to waitlist', 'You\'ll be notified when a space opens up');
  }, [agentReply, pushNotif]);

  // ── no-show response ──────────────────────────────────────────────────────
  const respondNoShow = useCallback((answer) => {
    if (answer === 'yes') {
      addMsg('resident', 'Yes, Alex is still coming.');
      agentReply("Great! The reservation for Alex is confirmed and will be held.", 800);
      setScenario(SCENARIO.BOOKING_CONFIRMED);
    } else if (answer === 'no') {
      addMsg('resident', 'No, Alex is not coming.');
      agentReply("Understood. I've released the reservation and will check the waitlist for any pending requests.", 900);
      if (soleActivePermit) {
        updateSpace(soleActivePermit.space, { status: STATUS.AVAILABLE, ownerUnit: null, visitor: null, permit: null, until: null });
        setActivePermits(prev => {
          const next = { ...prev };
          delete next[soleActivePermit.space];
          return next;
        });
      }
      setScenario(SCENARIO.IDLE);
      pushNotif('released', 'Reservation released', 'Space is now available for the community');
    } else {
      addMsg('resident', "Not sure yet.");
      agentReply("No problem. The reservation will be held until 4:15 PM under the 15-minute grace period.", 800, { gracePeriod: true });
      setScenario(SCENARIO.GRACE_PERIOD);
    }
  }, [addMsg, agentReply, soleActivePermit, updateSpace, pushNotif]);

  // ── grace period expiry ───────────────────────────────────────────────────
  const simulateGraceExpiry = useCallback(() => {
    agentReply("The 15-minute grace period has expired. The reservation has been released and the waitlist has been checked.", 600);
    if (soleActivePermit) {
      updateSpace(soleActivePermit.space, { status: STATUS.AVAILABLE, ownerUnit: null, visitor: null, permit: null, until: null });
      setActivePermits(prev => {
        const next = { ...prev };
        delete next[soleActivePermit.space];
        return next;
      });
    }
    setScenario(SCENARIO.IDLE);
    pushNotif('released', 'Grace period expired', 'Space released and waitlist checked');
  }, [agentReply, soleActivePermit, updateSpace, pushNotif]);

  // ── extension confirm ─────────────────────────────────────────────────────
  const confirmExtension = useCallback((until) => {
    addMsg('resident', `Extend to ${until}`);
    agentReply(`Alex's permit has been extended until ${until}. The extension has been applied.`, 800);
    if (soleActivePermit) {
      setActivePermits(prev => ({ ...prev, [soleActivePermit.space]: { ...prev[soleActivePermit.space], until } }));
      updateSpace(soleActivePermit.space, { until });
    }
    setScenario(SCENARIO.EXTENSION_DONE);
    pushNotif('success', 'Permit extended', `Alex's permit extended until ${until}`);
  }, [addMsg, agentReply, soleActivePermit, updateSpace, pushNotif]);

  // ── alternative time select ───────────────────────────────────────────────
  const selectAltTime = useCallback((slot) => {
    addMsg('resident', `Book ${slot}`);
    agentReply(`Visitor parking has been reserved for ${slot}. You'll receive a confirmation.`, 900);
    setScenario(SCENARIO.IDLE);
    pushNotif('success', 'Alternative time booked', slot);
  }, [addMsg, agentReply, pushNotif]);

  return {
    spaces, messages, scenario, activePermits, waitlistItem,
    notifications, selectedSpace, isTyping, isReleasing,
    offers, offerActionId, residentContext, switchUnit,
    setSelectedSpace,
    sendMessage, triggerQuickAction, releasePermit,
    acceptOffer, declineOffer,
    joinWaitlist, respondNoShow, simulateGraceExpiry,
    confirmExtension, selectAltTime,
    dismissNotif: (id) => setNotifications(prev => prev.filter(n => n.id !== id)),
  };
}
