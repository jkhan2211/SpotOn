import { useState, useCallback, useRef } from 'react';
import { INITIAL_SPACES, INITIAL_MESSAGES, STATUS, SCENARIO } from './residentData';

let msgId = 10;
const nextId = () => ++msgId;
const now = () => {
  const d = new Date();
  return d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
};

export function useResidentDemo() {
  const [spaces, setSpaces]           = useState(INITIAL_SPACES);
  const [messages, setMessages]       = useState(INITIAL_MESSAGES);
  const [scenario, setScenario]       = useState(SCENARIO.IDLE);
  const [activePermit, setActivePermit] = useState(null);
  const [waitlistItem, setWaitlistItem] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [selectedSpace, setSelectedSpace] = useState(null);
  const [isTyping, setIsTyping]       = useState(false);
  const pendingVisitor = useRef('');
  const notifId = useRef(0);

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

    // ── Scenario 1: normal booking ──────────────────────────────────────────
    if (scenario === SCENARIO.IDLE) {
      if (lower.includes('alex') || lower.includes('visitor') || lower.includes('brother') || lower.includes('friend')) {
        const nameMatch = text.match(/\b([A-Z][a-z]+)\b/);
        pendingVisitor.current = nameMatch ? nameMatch[1] : 'Alex';
        setScenario(SCENARIO.BOOKING_PLATE);
        agentReply(`Sure! What's ${pendingVisitor.current}'s licence plate number?`, 900);
        return;
      }
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
      agentReply("I can help with visitor parking, temporary resident parking, or waitlist requests. Try: \"My brother Alex is coming from 2–5 PM\" or use a quick action below.", 900);
      return;
    }

    // ── Scenario 1 continued: plate entry ──────────────────────────────────
    if (scenario === SCENARIO.BOOKING_PLATE) {
      const plate = text.trim().toUpperCase();
      setScenario(SCENARIO.BOOKING_CHECKING);
      agentReply("Checking community parking policy and availability...", 600, { processing: true });
      setTimeout(() => {
        setIsTyping(false);
        // Check if spaces are full (scenario 2)
        const available = spaces.filter(s => s.status === STATUS.AVAILABLE);
        if (available.length === 0) {
          setScenario(SCENARIO.FULL_WAITLIST);
          setMessages(prev => [...prev, {
            id: nextId(), role: 'agent', ts: now(),
            text: "Visitor parking is currently fully allocated during that time. I can place your request on the waitlist and notify you if compatible parking becomes available.",
            waitlistPrompt: true,
          }]);
          return;
        }
        const space = available[0];
        setScenario(SCENARIO.BOOKING_CONFIRMED);
        setMessages(prev => [...prev, {
          id: nextId(), role: 'agent', ts: now(),
          text: `Parking confirmed for ${pendingVisitor.current} from 2:00 PM to 5:00 PM. Visitor space ${space.id} has been reserved.`,
          permitCard: { visitor: pendingVisitor.current, plate, space: space.id, from: '2:00 PM', until: '5:00 PM', status: 'Upcoming' },
        }]);
        updateSpace(space.id, { status: STATUS.RESERVED, ownerUnit: '14', visitor: pendingVisitor.current, permit: 'SP-1042', until: '5:00 PM' });
        setActivePermit({ visitor: pendingVisitor.current, plate, space: space.id, from: '2:00 PM', until: '5:00 PM', status: 'Upcoming' });
        pushNotif('success', 'Visitor parking confirmed', `${pendingVisitor.current} — Space ${space.id}, 2:00–5:00 PM`);
      }, 2000);
      return;
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

    // ── fallback ────────────────────────────────────────────────────────────
    agentReply("I'm here to help with visitor parking, temporary parking, extensions, and waitlist requests. What do you need?", 900);
  }, [scenario, spaces, activePermit, addMsg, agentReply, pushNotif, updateSpace]);

  // ── quick actions ─────────────────────────────────────────────────────────
  const triggerQuickAction = useCallback((action) => {
    switch (action) {
      case 'book':
        addMsg('resident', 'My brother Alex is coming from 2–5 PM.');
        setScenario(SCENARIO.BOOKING_PLATE);
        pendingVisitor.current = 'Alex';
        agentReply("Sure! What's Alex's licence plate number?", 900);
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
