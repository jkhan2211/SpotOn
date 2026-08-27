import { useState, useCallback, useRef } from 'react';
import {
  INITIAL_ADMIN_SPACES, INITIAL_VEHICLE_QUEUE, INITIAL_WAITLIST,
  INITIAL_ACTIVITY, INITIAL_ADMIN_MESSAGES, ADMIN_STATUS, POLICIES,
} from './adminData';

let msgId = 20;
const nextId = () => ++msgId;
const now = () => new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });

export function useAdminDemo() {
  const [spaces,       setSpaces]       = useState(INITIAL_ADMIN_SPACES);
  const [messages,     setMessages]     = useState(INITIAL_ADMIN_MESSAGES);
  const [isTyping,     setIsTyping]     = useState(false);
  const [vehicleQueue, setVehicleQueue] = useState(INITIAL_VEHICLE_QUEUE);
  const [waitlist]                      = useState(INITIAL_WAITLIST);
  const [activity,     setActivity]     = useState(INITIAL_ACTIVITY);
  const [selectedSpace, setSelectedSpace] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const notifId = useRef(0);

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

  const updateSpace = useCallback((spaceId, patch) => {
    setSpaces(prev => prev.map(s => s.id === spaceId ? { ...s, ...patch } : s));
  }, []);

  // ── send message ──────────────────────────────────────────────────────────────
  const sendMessage = useCallback((text) => {
    if (!text.trim()) return;
    addMsg('admin', text);
    const lower = text.toLowerCase();

    // ── Scenario 1 & 4: vehicle lookup ────────────────────────────────────────
    const plateMatch = text.match(/\b([A-Z]{2,3}\d{3,4}|\d{3,4}[A-Z]{2,3})\b/i);
    if (plateMatch || lower.includes('xyz999') || lower.includes('abc123') || lower.includes('vehicle') || lower.includes('plate') || lower.includes('check')) {
      const plate = plateMatch ? plateMatch[1].toUpperCase() : (lower.includes('abc123') ? 'ABC123' : 'XYZ999');

      // Step-by-step investigation
      agentReply('Checking active visitor permits...', 600, { processing: true });
      setTimeout(() => {
        setIsTyping(true);
        setTimeout(() => {
          setIsTyping(false);
          setMessages(prev => [...prev, { id: nextId(), role: 'agent', ts: now(), text: 'Checking resident vehicle records...', processing: true }]);
          setTimeout(() => {
            setIsTyping(true);
            setTimeout(() => {
              setIsTyping(false);
              setMessages(prev => [...prev, { id: nextId(), role: 'agent', ts: now(), text: 'Checking temporary resident permits...', processing: true }]);
              setTimeout(() => {
                setIsTyping(true);
                setTimeout(() => {
                  setIsTyping(false);
                  // ABC123 = known match
                  if (plate === 'ABC123') {
                    setMessages(prev => [...prev, {
                      id: nextId(), role: 'agent', ts: now(),
                      text: `${plate} matches an active visitor permit for Unit 24, valid until 5:00 PM. No action required.`,
                      infoCard: { plate, unit: '24', permit: 'SP-1042', until: '5:00 PM', space: 'V07' },
                    }]);
                  } else {
                    // Unknown vehicle
                    setMessages(prev => [...prev, {
                      id: nextId(), role: 'agent', ts: now(),
                      text: `I couldn't match ${plate} to an active visitor permit, registered resident vehicle, or temporary parking permit. I've added it to Vehicles Requiring Review.`,
                    }]);
                    // Add to queue if not already there
                    setVehicleQueue(prev => {
                      if (prev.find(v => v.plate === plate)) return prev;
                      return [...prev, {
                        id: `VR-00${prev.length + 1}`,
                        plate, space: 'V11',
                        firstSeen: `Today, ${now()}`, lastSeen: `Today, ${now()}`,
                        observations: 1, permitMatch: 'None', residentMatch: 'None', tempMatch: 'None',
                        history: [{ date: 'Today', time: now() }],
                        status: 'pending', prevDecision: null,
                      }];
                    });
                    updateSpace('V11', { status: ADMIN_STATUS.REVIEW, plate });
                    logActivity(`${plate} added to vehicle review queue.`, 'SpotOn');
                    pushNotif('warning', 'Vehicle added to review queue', `${plate} — no matching permit or resident record`);
                  }
                }, 900);
              }, 700);
            }, 700);
          }, 700);
        }, 700);
      }, 700);
      return;
    }

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

    agentReply("I can help with vehicle lookups, capacity queries, waitlist status, recent activity, and parking policy. What do you need?", 900);
  }, [spaces, waitlist, activity, addMsg, agentReply, pushNotif, logActivity, updateSpace]);

  // ── quick actions ─────────────────────────────────────────────────────────────
  const triggerQuickAction = useCallback((action) => {
    switch (action) {
      case 'vehicles':
        addMsg('admin', 'Show vehicles requiring review.');
        agentReply(`There is currently ${vehicleQueue.filter(v => v.status === 'pending').length} vehicle requiring review. Plate XYZ999 has been observed 3 times with no matching permit or resident record.`, 900, { showVehicleQueue: true });
        break;
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
  }, [vehicleQueue, waitlist, activity, addMsg, agentReply, sendMessage]);

  // ── vehicle review decision ───────────────────────────────────────────────────
  const resolveVehicle = useCallback((vehicleId, decision) => {
    setVehicleQueue(prev => prev.map(v =>
      v.id === vehicleId
        ? { ...v, status: decision, prevDecision: { decision, date: now() } }
        : v
    ));
    const vehicle = vehicleQueue.find(v => v.id === vehicleId);
    if (!vehicle) return;
    const label = decision === 'recognized' ? 'Marked Recognized' : 'Kept Unapproved';
    logActivity(`${vehicle.plate} — ${label} by administrator.`, 'Admin');
    pushNotif(decision === 'recognized' ? 'success' : 'info', `${vehicle.plate} ${label}`, `Decision recorded in audit log`);
    if (decision === 'recognized') {
      updateSpace(vehicle.space, { status: ADMIN_STATUS.AVAILABLE, plate: null });
    }
    addMsg('agent', `${vehicle.plate} has been ${decision === 'recognized' ? 'marked as recognized' : 'kept as unapproved'}. The decision has been recorded in the audit log.`);
  }, [vehicleQueue, addMsg, logActivity, pushNotif, updateSpace]);

  return {
    spaces, messages, isTyping, vehicleQueue, waitlist, activity,
    selectedSpace, notifications,
    setSelectedSpace,
    sendMessage, triggerQuickAction, resolveVehicle,
    dismissNotif: (id) => setNotifications(prev => prev.filter(n => n.id !== id)),
  };
}
