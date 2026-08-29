import { useState, useCallback, useRef, useEffect } from 'react';
import { INITIAL_SPACES, INITIAL_MESSAGES, STATUS, SCENARIO } from './residentData';

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
  const [activePermit, setActivePermit] = useState(null);
  const [waitlistItem, setWaitlistItem] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [selectedSpace, setSelectedSpace] = useState(null);
  const [isTyping, setIsTyping]       = useState(false);
  const pendingVisitor = useRef('');
  const notifId = useRef(0);

  // ── fetch spaces from backend ─────────────────────────────────────────────
  const fetchSpaces = useCallback(() => {
    fetch('http://localhost:8000/api/parking-spaces')
      .then(res => res.json())
      .then(data => setSpaces(data.spaces))
      .catch(err => console.error('Failed to fetch parking spaces:', err));
  }, []);

  useEffect(() => { fetchSpaces(); }, [fetchSpaces]);

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
          setActivePermit({ type: 'temp', visitor: 'Contractor', space: 'V04', from: 'Now', until: '6:00 PM', plate: '—', status: 'Active' });
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

    // ── Scenario 3: early release ───────────────────────────────────────────
    if (scenario === SCENARIO.BOOKING_CONFIRMED && (lower.includes('left') || lower.includes('early') || lower.includes('gone') || lower.includes('release'))) {
      const permit = activePermit;
      if (!permit) { agentReply("I don't see an active permit to release. Let me know if you need help.", 800); return; }
      setScenario(SCENARIO.EARLY_RELEASE);
      agentReply(`${permit.visitor}'s permit has been closed and visitor space ${permit.space} is now available. I'll check whether another resident is waiting for this time window.`, 1000);
      updateSpace(permit.space, { status: STATUS.AVAILABLE, ownerUnit: null, visitor: null, permit: null, until: null });
      pushNotif('released', `${permit.space} has been released`, `${permit.visitor}'s permit closed early`);
      // Scenario 4: reallocation after short delay
      setTimeout(() => {
        agentReply(`A compatible waitlisted request was found. Space ${permit.space} has been offered to the next eligible resident.`, 1200);
        updateSpace(permit.space, { status: STATUS.RESERVED, ownerUnit: null, visitor: null, permit: 'SP-1043', until: '5:00 PM' });
        setActivePermit(null);
        setWaitlistItem(null);
        setScenario(SCENARIO.REALLOCATION);
        pushNotif('info', 'Space reallocated', `${permit.space} has been assigned to a waitlisted resident`);
      }, 3500);
      return;
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
      body: JSON.stringify({ message: text }),
    })
      .then(res => res.json())
      .then(data => {
        setIsTyping(false);
        addMsg('agent', data.message);
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
          setActivePermit(permit);
          setScenario(SCENARIO.BOOKING_CONFIRMED);
          updateSpace(permit.space, { status: STATUS.RESERVED, ownerUnit: '14', visitor: permit.visitor, permit: permit.permitId, until: permit.until });
          pushNotif('success', 'Visitor parking confirmed', `${permit.visitor} — Space ${permit.space}, ${permit.from}–${permit.until}`);
        }
        fetchSpaces();
      })
      .catch(() => {
        setIsTyping(false);
        addMsg('agent', "Sorry, I couldn't reach the SpotOn server. Please try again.");
      });
  }, [scenario, activePermit, addMsg, agentReply, pushNotif, updateSpace, fetchSpaces]);

  // ── quick actions ─────────────────────────────────────────────────────────
  const triggerQuickAction = useCallback((action) => {
    switch (action) {
      case 'book':
        sendMessage('My brother Alex is coming from 2–5 PM.');
        break;
      case 'release':
        if (activePermit) {
          addMsg('resident', `${activePermit.visitor} left early.`);
          sendMessage(`${activePermit.visitor} left early.`);
        } else {
          addMsg('resident', 'I need to release a parking space.');
          agentReply("I don't see an active permit to release. Let me know the space or visitor name.", 800);
        }
        break;
      case 'extend':
        if (activePermit) {
          addMsg('resident', `${activePermit.visitor} needs another two hours.`);
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
          setActivePermit({ type: 'temp', visitor: 'Contractor', space: 'V04', from: 'Now', until: '6:00 PM', plate: '—', status: 'Active' });
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
  }, [activePermit, addMsg, agentReply, pushNotif, updateSpace, sendMessage]);

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
      if (activePermit) {
        updateSpace(activePermit.space, { status: STATUS.AVAILABLE, ownerUnit: null, visitor: null, permit: null, until: null });
        setActivePermit(null);
      }
      setScenario(SCENARIO.IDLE);
      pushNotif('released', 'Reservation released', 'Space is now available for the community');
    } else {
      addMsg('resident', "Not sure yet.");
      agentReply("No problem. The reservation will be held until 4:15 PM under the 15-minute grace period.", 800, { gracePeriod: true });
      setScenario(SCENARIO.GRACE_PERIOD);
    }
  }, [addMsg, agentReply, activePermit, updateSpace, pushNotif]);

  // ── grace period expiry ───────────────────────────────────────────────────
  const simulateGraceExpiry = useCallback(() => {
    agentReply("The 15-minute grace period has expired. The reservation has been released and the waitlist has been checked.", 600);
    if (activePermit) {
      updateSpace(activePermit.space, { status: STATUS.AVAILABLE, ownerUnit: null, visitor: null, permit: null, until: null });
      setActivePermit(null);
    }
    setScenario(SCENARIO.IDLE);
    pushNotif('released', 'Grace period expired', 'Space released and waitlist checked');
  }, [agentReply, activePermit, updateSpace, pushNotif]);

  // ── extension confirm ─────────────────────────────────────────────────────
  const confirmExtension = useCallback((until) => {
    addMsg('resident', `Extend to ${until}`);
    agentReply(`Alex's permit has been extended until ${until}. The extension has been applied.`, 800);
    if (activePermit) {
      setActivePermit(prev => ({ ...prev, until }));
      updateSpace(activePermit.space, { until });
    }
    setScenario(SCENARIO.EXTENSION_DONE);
    pushNotif('success', 'Permit extended', `Alex's permit extended until ${until}`);
  }, [addMsg, agentReply, activePermit, updateSpace, pushNotif]);

  // ── alternative time select ───────────────────────────────────────────────
  const selectAltTime = useCallback((slot) => {
    addMsg('resident', `Book ${slot}`);
    agentReply(`Visitor parking has been reserved for ${slot}. You'll receive a confirmation.`, 900);
    setScenario(SCENARIO.IDLE);
    pushNotif('success', 'Alternative time booked', slot);
  }, [addMsg, agentReply, pushNotif]);

  return {
    spaces, messages, scenario, activePermit, waitlistItem,
    notifications, selectedSpace, isTyping,
    setSelectedSpace,
    sendMessage, triggerQuickAction,
    joinWaitlist, respondNoShow, simulateGraceExpiry,
    confirmExtension, selectAltTime,
    dismissNotif: (id) => setNotifications(prev => prev.filter(n => n.id !== id)),
  };
}
