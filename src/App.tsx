import { useEffect, useMemo, useRef, useState } from 'react';
import { AlarmClock, ArrowDownRight, ArrowLeft, ArrowRight, Bell, Check, ChevronRight, CircleHelp, Clock3, Coffee, Compass, CreditCard, Home, Moon, MoreHorizontal, Play, Plus, Settings, ShieldAlert, Sparkles, Sun, Target, Timer, X } from 'lucide-react';
import { advanceScheduledCalls, formatCountdown, fromLocalDateTimeValue, getNextScheduledCall, makeScheduledCall, readScheduledCalls, toLocalDateTimeValue, upsertScheduledCall, writeScheduledCalls, type ScheduledCall } from './calls';

type Task = { id: string; title: string; description: string; deadline: string; duration: number; firstAction: string; evidence: string; callAt: string; confirmed: boolean; started: boolean; completed: boolean };
type EventItem = { type: string; at: number; task?: string; note?: string };
const DEMO: Task[] = [{ id: 'demo-1', title: 'Review operating systems', description: 'Prepare for Friday’s systems exam by revisiting the process scheduling lecture.', deadline: '2026-10-31', duration: 45, firstAction: 'Open the process scheduling lecture slides and find the section on round-robin scheduling.', evidence: 'Show the lecture slides open to the topic you plan to review.', callAt: new Date(Date.now() + 12 * 60000).toISOString(), confirmed: true, started: false, completed: false }];
const settlements = [{ name: 'Morrow Bay', subtitle: 'A quiet harbor for new beginnings', color: 'bay', icon: '◒', progress: 48 }, { name: 'Vesper Reach', subtitle: 'A lantern city above the clouds', color: 'vesper', icon: '✳', progress: 16 }, { name: 'The Glasswood', subtitle: 'A forest that remembers every dawn', color: 'glass', icon: '❋', progress: 4 }];
const fmt = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
type PermissionStatus = NotificationPermission | 'unsupported';
const currentNotificationPermission = (): PermissionStatus => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
const permissionHelp = (status: PermissionStatus) => status === 'unsupported'
  ? 'This browser does not support desktop notifications. The Call is saved locally, but no alert can be delivered.'
  : status === 'denied'
    ? 'The Call is saved locally, but this site is blocked from showing notifications. Allow Notifications in the browser site settings.'
    : 'The Call is saved locally, but browser notification permission has not been granted.';
const playCallChime = async (context: AudioContext | null) => {
  if (!context) return;
  if (context.state !== 'running') {
    try { await context.resume(); } catch { return; }
  }
  if (context.state !== 'running') return;
  const start = context.currentTime;
  [659.25, 783.99, 987.77].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = start + index * 0.23;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.13, at + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(at); oscillator.stop(at + 0.56);
  });
};

export default function App() {
  const [theme, setTheme] = useState<'light'|'dark'>(() => (localStorage.getItem('amoment-theme') as 'light'|'dark') || 'light');
  const [page, setPage] = useState('home');
  const [tasks, setTasks] = useState<Task[]>(() => JSON.parse(localStorage.getItem('amoment-tasks') || 'null') || DEMO);
  const [events, setEvents] = useState<EventItem[]>(() => JSON.parse(localStorage.getItem('amoment-events') || '[]'));
  const [scheduledCalls, setScheduledCalls] = useState<ScheduledCall[]>(() => readScheduledCalls());
  const [taskId, setTaskId] = useState(tasks[0]?.id || '');
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<Task | null>(null);
  const [secs, setSecs] = useState(30 * 60);
  const [running, setRunning] = useState(false);
  const [returnAt, setReturnAt] = useState('');
  const [sound, setSound] = useState(() => localStorage.getItem('amoment-call-sound') === 'true');
  const [permission, setPermission] = useState<PermissionStatus>(() => currentNotificationPermission());
  const [scheduleAt, setScheduleAt] = useState('');
  const [preparationMinutes, setPreparationMinutes] = useState(5);
  const [clockNow, setClockNow] = useState(Date.now());
  const audioContext = useRef<AudioContext | null>(null);
  const [notice, setNotice] = useState('');
  const task = tasks.find(t => t.id === taskId) || tasks[0];
  const nextScheduledCall = getNextScheduledCall(scheduledCalls, clockNow);
  const currentScheduledCall = task ? scheduledCalls.find(call => call.taskId === task.id && !call.test) : undefined;

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('amoment-theme', theme); }, [theme]);
  useEffect(() => { localStorage.setItem('amoment-tasks', JSON.stringify(tasks)); }, [tasks]);
  useEffect(() => { localStorage.setItem('amoment-events', JSON.stringify(events)); }, [events]);
  useEffect(() => { localStorage.setItem('amoment-call-sound', String(sound)); }, [sound]);
  useEffect(() => {
    if (page === 'task' && task) {
      setScheduleAt(toLocalDateTimeValue(currentScheduledCall?.callAt || task.callAt));
      setPreparationMinutes(currentScheduledCall?.preparationMinutes ?? 5);
    }
  }, [page, task?.id, currentScheduledCall?.callAt, currentScheduledCall?.preparationMinutes]);
  useEffect(() => { if (!running) return; const id = window.setInterval(() => setSecs(s => { if (s <= 1) { setRunning(false); setEvents(e => [...e, { type: 'focus-completed', at: Date.now(), task: task?.title }]); setNotice('Lock-In complete. You showed up for this moment.'); return 0; } return s - 1; }), 1000); return () => clearInterval(id); }, [running, task?.title]);
  useEffect(() => {
    let disposed = false;
    const process = () => {
      const canNotify = currentNotificationPermission() === 'granted';
      const stored = readScheduledCalls();
      const advanced = advanceScheduledCalls(stored, Date.now(), undefined, canNotify);
      if (disposed || advanced.actions.length === 0) return;
      writeScheduledCalls(advanced.calls);
      setScheduledCalls(advanced.calls);
      for (const action of advanced.actions) {
        const { call, kind, lateByMs } = action;
        if (kind === 'missed') {
          setEvents(existing => [...existing, { type: 'call-missed', at: Date.now(), task: call.title, note: `Missed by ${Math.round(lateByMs / 60000)} minutes` }]);
          continue;
        }
        try {
          const isCall = kind === 'call';
          const notification = new Notification(
            call.test ? 'AMoment test Call' : isCall ? 'Your AMoment Call is here' : 'Get ready for your AMoment Call',
            {
              body: call.test ? 'Your test reminder is working.' : isCall ? `${call.firstAction || `It’s time to begin: ${call.title}`}${lateByMs > 0 ? ' (a little later than planned)' : ''}` : `Your Call for “${call.title}” is coming up. Take a moment to get set up.`,
              tag: `amoment-${call.id}-${kind}`,
              requireInteraction: isCall,
            },
          );
          notification.onclick = () => {
            window.focus();
            if (!call.test) setTaskId(call.taskId);
            setPage(call.test ? 'settings' : kind === 'preparation' ? 'task' : 'call');
            notification.close();
          };
          if (isCall) {
            if (sound) void playCallChime(audioContext.current);
            if ('vibrate' in navigator) navigator.vibrate([220, 110, 220]);
            if (!call.test) { setTaskId(call.taskId); setPage('call'); }
          }
          setEvents(existing => [...existing, { type: kind === 'preparation' ? 'preparation-reminder-sent' : 'call-notification-sent', at: Date.now(), task: call.title, note: call.test ? 'Test Call' : undefined }]);
        } catch {
          setNotice('The browser saved this reminder but could not display a desktop notification. Check this site’s notification permission.');
        }
      }
    };
    const cycle = () => {
      const nav = navigator as Navigator & { locks?: LockManager };
      if (nav.locks) {
        void nav.locks.request('amoment-scheduler', { ifAvailable: true }, lock => { if (lock && !disposed) process(); });
      } else process();
    };
    const refreshStatus = () => { setClockNow(Date.now()); setPermission(currentNotificationPermission()); cycle(); };
    const interval = window.setInterval(refreshStatus, 1000);
    document.addEventListener('visibilitychange', refreshStatus);
    window.addEventListener('focus', refreshStatus);
    cycle();
    return () => { disposed = true; window.clearInterval(interval); document.removeEventListener('visibilitychange', refreshStatus); window.removeEventListener('focus', refreshStatus); };
  }, [sound]);
  const record = (type: string, note?: string) => setEvents(e => [...e, { type, at: Date.now(), task: task?.title, note }]);
  const patchTask = (id: string, fields: Partial<Task>) => setTasks(ts => ts.map(t => t.id === id ? { ...t, ...fields } : t));
  const askNotificationPermission = async (): Promise<PermissionStatus> => {
    if (typeof Notification === 'undefined') { setPermission('unsupported'); return 'unsupported'; }
    let result = Notification.permission;
    if (result === 'default') {
      try { result = await Notification.requestPermission(); }
      catch { result = Notification.permission; }
    }
    setPermission(result);
    return result;
  };
  const enableCallSound = async () => {
    if (sound) { setSound(false); setNotice('Call sound is off.'); return; }
    try {
      const AudioContextConstructor = window.AudioContext;
      if (!AudioContextConstructor) { setNotice('This browser does not support Web Audio. Desktop notifications can still work.'); return; }
      audioContext.current ??= new AudioContextConstructor();
      await audioContext.current.resume();
      if (audioContext.current.state !== 'running') throw new Error('Audio remains suspended');
      setSound(true);
      void playCallChime(audioContext.current);
      setNotice('Call sound is enabled for this browser.');
    } catch {
      setNotice('The browser could not enable audio. Try interacting with the page again, or leave Call sound off.');
    }
  };
  const scheduleCallForTask = async () => {
    if (!task) return;
    try {
      const callAt = fromLocalDateTimeValue(scheduleAt);
      if (Date.parse(callAt) <= Date.now()) { setNotice('Choose a Call time in the future.'); return; }
      const permissionResult = await askNotificationPermission();
      const scheduled = makeScheduledCall({ id: task.id, taskId: task.id, title: task.title, firstAction: task.firstAction, callAt, preparationMinutes });
      const next = upsertScheduledCall(readScheduledCalls(), scheduled);
      writeScheduledCalls(next); setScheduledCalls(next); patchTask(task.id, { callAt });
      setEvents(existing => [...existing, { type: 'call-scheduled', at: Date.now(), task: task.title, note: new Date(callAt).toLocaleString() }]);
      setNotice(permissionResult === 'granted' ? `Call scheduled for ${new Date(callAt).toLocaleString()}.` : permissionHelp(permissionResult));
    } catch {
      setNotice('Choose a valid future date and time for your Call.');
    }
  };
  const startTestCall = async () => {
    const stored = readScheduledCalls();
    const pending = stored.find(call => call.test && call.status === 'scheduled');
    if (pending) {
      const next = stored.map(call => call.id === pending.id ? { ...call, status: 'cancelled' as const } : call);
      writeScheduledCalls(next); setScheduledCalls(next); setNotice('Test Call cancelled.'); return;
    }
    const permissionResult = await askNotificationPermission();
    const call = makeScheduledCall({ id: `test-${crypto.randomUUID()}`, taskId: 'test-call', title: 'AMoment test Call', firstAction: 'Your test reminder is working.', callAt: new Date(Date.now() + 10_000).toISOString(), preparationMinutes: 0, test: true });
    const next = upsertScheduledCall(stored, call);
    writeScheduledCalls(next); setScheduledCalls(next);
    setNotice(permissionResult === 'granted' ? 'Test Call set. Notification and enabled sound will fire in about 10 seconds.' : 'Test Call is saved for 10 seconds from now, but browser permission is not enabled.');
  };
  const createDraft = () => {
    const title = prompt.trim().replace(/[.!?]$/, '') || 'Work on my next task';
    setDraft({ id: crypto.randomUUID(), title: title.length > 48 ? title.slice(0, 48) : title, description: `A plan based on: “${prompt.trim() || title}”`, deadline: '', duration: 30, firstAction: `Set up what you need for “${title}” and work on the smallest visible first step.`, evidence: 'Show the relevant materials or workspace ready to begin.', callAt: new Date(Date.now() + 30 * 60000).toISOString(), confirmed: false, started: false, completed: false }); setPage('review');
  };
  const saveDraft = async () => { if (!draft) return; if (Date.parse(draft.callAt) <= Date.now()) { setNotice('Choose a future Call time in your plan before confirming.'); return; } const permissionResult = await askNotificationPermission(); const saved = { ...draft, confirmed: true }; const scheduled = makeScheduledCall({ id: saved.id, taskId: saved.id, title: saved.title, firstAction: saved.firstAction, callAt: saved.callAt, preparationMinutes: 5 }); const nextCalls = upsertScheduledCall(readScheduledCalls(), scheduled); writeScheduledCalls(nextCalls); setScheduledCalls(nextCalls); setTasks(ts => [saved, ...ts]); setTaskId(saved.id); setEvents(e => [...e, { type: 'task-created', at: Date.now(), task: saved.title }, { type: 'call-scheduled', at: Date.now(), task: saved.title }]); setDraft(null); setPrompt(''); setPage('task'); setNotice(permissionResult === 'granted' ? 'Plan saved and Call scheduled. You’ll get a preparation reminder before it.' : permissionHelp(permissionResult)); };
  const beginTask = () => { if (!task) return; patchTask(task.id, { started: true }); record('task-started'); setSecs(1800); setRunning(true); setPage('lockin'); setNotice('Demo evidence accepted. Your 30-minute Lock-In has begun.'); };
  const leaveLockin = () => { setRunning(false); setPage('exception'); };
  const submitException = () => { const when = returnAt ? new Date(returnAt).getTime() : Date.now() + 30 * 60000; record('exception-used', new Date(when).toISOString()); setPage('home'); setNotice(`Exception recorded. Demo return reminder set for ${new Date(when).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`); setReturnAt(''); };
  const nav = [{ id:'home', label:'Today', icon:Home }, { id:'create', label:'Plan a task', icon:Plus }, { id:'analytics', label:'Your patterns', icon:Compass }, { id:'universe', label:'Universe', icon:Sparkles }, { id:'premium', label:'Expansion', icon:CreditCard }, { id:'settings', label:'Settings', icon:Settings }];
  const title = useMemo(() => ({home:'Your next moment',create:'Make a plan',review:'Take a look',task:'Task details',call:'The Call',evidence:'Ready to begin?',lockin:'Lock-In',exception:'The Exception',analytics:'Your patterns',universe:'A world in progress',premium:'More worlds await',settings:'Settings'} as Record<string,string>)[page] || 'AMoment', [page]);
  const goCall = () => { if (!task) return; record('call-acknowledged'); setPage('call'); };
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">a<span>.</span></div><span>AMoment</span></div><div className="side-label">YOUR SPACE</div><nav>{nav.map(n => <button key={n.id} className={`nav-item ${page===n.id?'active':''}`} onClick={() => setPage(n.id)}><n.icon size={18}/><span>{n.label}</span>{n.id==='home' && <span className="nav-dot"/>}</button>)}</nav><div className="side-bottom"><div className="side-world"><div className="mini-orbit">◒</div><div><b>Morrow Bay</b><span>Settling in</span></div><ChevronRight size={16}/></div><div className="profile"><div className="avatar">G</div><div><b>Your demo space</b><span>Local preview</span></div><MoreHorizontal size={18}/></div></div></aside>
    <main className="main"><header className="topbar"><div className="mobile-brand"><div className="brand-mark">a<span>.</span></div> AMoment</div><div className="breadcrumbs"><span>AMoment</span><ChevronRight size={14}/><b>{title}</b></div><div className="top-actions"><span className="demo-badge"><i/> LOCAL REMINDERS</span><button className="icon-button" title="Toggle theme" aria-label="Toggle theme" onClick={() => setTheme(theme==='light'?'dark':'light')}>{theme==='light'?<Moon size={17}/>:<Sun size={17}/>}</button><button className="icon-button" title="Notification settings" aria-label="Notification settings" onClick={()=>setPage('settings')}><Bell size={17}/></button><div className="avatar small">G</div></div></header>
      <div className="content"><div className="page-heading"><div><div className="eyebrow">{page==='home'?'THURSDAY, OCTOBER 30':page==='analytics'?'A GENTLER KIND OF PROGRESS':'AMOMENT · LOCAL PREVIEW'}</div><h1>{title}</h1></div>{page==='home'&&<button className="button primary" onClick={()=>setPage('create')}><Plus size={16}/> Plan a task</button>}</div>
      {notice&&<div className="notice"><Check size={16}/>{notice}<button aria-label="Dismiss" onClick={()=>setNotice('')}><X size={15}/></button></div>}
      {page==='home'&&<><section className="welcome-row cosmic-welcome"><div className="welcome-copy"><div className="welcome-kicker"><span className="sun-dot">✳</span> A little room to begin</div><h2>One small start can<br/>change the shape of today.</h2><p>You don’t need to feel ready. Just take the first step.</p><div className="world-progress"><span>YOUR WORLD IS WAKING</span><b>{Math.min(100,48+events.filter(e=>e.type==='task-started'||e.type==='focus-completed').length*2)}%</b><div><i style={{width:`${Math.min(100,48+events.filter(e=>e.type==='task-started'||e.type==='focus-completed').length*2)}%`}}/></div></div></div><div className="cosmos-scene" role="img" aria-label="Morrow Bay, a pastel settlement planet with orbiting moons and distant worlds"><div className="starfield"><i/><i/><i/><i/><i/><i/><i/><i/></div><div className="distant-world world-lilac"/><div className="distant-world world-gold"/><div className="moonlet"/><div className="planet-orbit orbit-a"/><div className="planet-orbit orbit-b"/><div className="home-planet"><div className="planet-atmosphere"/><div className="planet-land land-a"/><div className="planet-land land-b"/><div className="planet-city"><i/><i/><i/><i/><i/></div></div><div className="cosmos-caption"><span className="caption-orbit"/> <span><b>MORROW BAY</b><small>HOME WORLD · SECTOR 01</small></span></div></div></section>
        <div className="section-title"><div><h2>Today, gently</h2><p>Your commitments, one moment at a time.</p></div><button className="text-button" onClick={()=>setPage('analytics')}>View patterns <ArrowRight size={15}/></button></div>
        <div className="dashboard-grid"><section className="panel commitments"><div className="panel-head"><div className="panel-icon"><Target size={17}/></div><div><h3>Today's commitment</h3><span>One thing you chose to begin</span></div><button className="quiet-icon" onClick={()=>setPage('task')} aria-label="Open task"><MoreHorizontal size={18}/></button></div>
          {task?<div className="task-card"><div className="task-time"><span className="time-mark"/><span>{currentScheduledCall?.status === 'scheduled' ? `CALL AT ${fmt(currentScheduledCall.callAt).toUpperCase()}` : 'CALL NOT SCHEDULED'}</span><span className="time-line"/></div><h3>{task.title}</h3><p>{task.description}</p><div className="task-meta"><span><Clock3 size={14}/>{task.duration} min</span>{task.deadline&&<span><AlarmClock size={14}/>Due {new Date(task.deadline+'T12:00:00').toLocaleDateString([], {month:'short',day:'numeric'})}</span>}</div><div className="first-step"><div className="step-icon"><ArrowDownRight size={16}/></div><div><b>YOUR FIRST STEP</b><span>{task.firstAction}</span></div></div><button className="button primary full" onClick={goCall}><Bell size={16}/> Start with the Call <ArrowRight size={16}/></button></div>:<div className="empty"><p>No commitments yet. Make a small plan for today.</p><button className="button primary" onClick={()=>setPage('create')}>Plan a task</button></div>}
        </section><section className="panel next-call"><div className="panel-head"><div className="panel-icon lavender"><AlarmClock size={17}/></div><div><h3>Your next Call</h3><span>A clear cue to get moving</span></div></div>{nextScheduledCall?<><div className="call-time"><span>{fmt(nextScheduledCall.callAt)}</span><small>{new Date(nextScheduledCall.callAt).toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'})} · in {formatCountdown(nextScheduledCall.callAt,clockNow)}</small></div><div className="call-rule"/><p className="call-copy">“{nextScheduledCall.firstAction || nextScheduledCall.title}”</p><button className="button secondary full" onClick={()=>{setTaskId(nextScheduledCall.taskId);setPage(nextScheduledCall.test?'settings':'task')}}>Review Call details <ArrowRight size={15}/></button><div className="call-note"><CircleHelp size={14}/>{permission==='granted'?'Desktop notifications enabled while this browser is running':'Notifications need browser permission'}</div></>:<><p className="muted">No Calls are scheduled yet.</p>{task&&<button className="button secondary full" onClick={()=>setPage('task')}>Schedule a Call <AlarmClock size={15}/></button>}</>}</section></div>
        <section className="tiny-note"><ShieldAlert size={15}/><span>Calls can notify you while this browser is running. AMoment cannot alert you after the browser is fully closed.</span><button onClick={()=>setPage('settings')}>Notification settings</button></section>
      </>}
      {page==='create'&&<div className="form-layout"><section className="panel form-panel"><div className="form-intro"><div className="panel-icon"><Sparkles size={18}/></div><h2>What have you been putting off?</h2><p>Write it the way you’d say it. We’ll make a simple first-step plan you can edit.</p></div><label className="field-label" htmlFor="task-prompt">YOUR TASK</label><textarea id="task-prompt" rows={4} placeholder="e.g. I need to study operating systems before Friday" value={prompt} onChange={e=>setPrompt(e.target.value)}/><div className="form-hint"><Sparkles size={14}/> This is a local demo plan. AI planning is not connected yet.</div><button className="button primary" onClick={createDraft}>Make my plan <ArrowRight size={16}/></button></section><aside className="aside-note"><div className="aside-illustration">✳</div><h3>Make the beginning small.</h3><p>The first action should be something you can do in under two minutes, even if the whole task feels big.</p><div className="example"><span>INSTEAD OF</span><p>“Study for the exam”</p><ArrowDownRight size={15}/><span>TRY</span><p>“Open the slides to the scheduling section”</p></div></aside></div>}
      {page==='review'&&draft&&<div className="review-wrap"><div className="review-label"><div className="step-number">01</div><div><b>Your plan, ready to shape</b><span>Everything here can be changed before you save.</span></div></div><section className="panel review-panel"><label className="field-label">TASK TITLE</label><input value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/><label className="field-label">A LITTLE CONTEXT</label><textarea rows={2} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/><div className="two-fields"><div><label className="field-label">DEADLINE <span>(optional)</span></label><input type="date" value={draft.deadline} onChange={e=>setDraft({...draft,deadline:e.target.value})}/></div><div><label className="field-label">ESTIMATED TIME</label><select value={draft.duration} onChange={e=>setDraft({...draft,duration:Number(e.target.value)})}><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option><option value="90">1.5 hours</option></select></div></div><label className="field-label">YOUR FIRST ACTION</label><textarea rows={2} value={draft.firstAction} onChange={e=>setDraft({...draft,firstAction:e.target.value})}/><label className="field-label">DEMO EVIDENCE</label><input value={draft.evidence} onChange={e=>setDraft({...draft,evidence:e.target.value})}/><div className="two-fields"><div><label className="field-label">SUGGESTED CALL TIME</label><input type="datetime-local" value={toLocalDateTimeValue(draft.callAt)} onChange={e=>{const value=e.target.value;if(value)setDraft({...draft,callAt:new Date(value).toISOString()})}}/></div><div className="recommendation"><Sparkles size={15}/><span>Initial suggestion · based on a 30-minute planning interval</span></div></div><div className="plan-explanation">Confirming saves the Call on this device and asks browser permission so AMoment can alert you while the browser is running. This initial time suggestion uses no personal history.</div><div className="button-row"><button className="button secondary" onClick={()=>{setDraft(null);setPage('create')}}><ArrowLeft size={15}/> Edit request</button><button className="button primary" onClick={saveDraft}>Confirm plan & schedule <Check size={16}/></button></div></section></div>}
      {page==='task'&&task&&<div className="detail-grid"><section className="panel detail-panel"><div className="task-overline"><span className="status-pill"><i/>{task.started?'IN PROGRESS':'UP NEXT'}</span><button className="text-button" onClick={()=>setPage('review')}>Edit plan</button></div><h2>{task.title}</h2><p>{task.description}</p><div className="detail-rule"/><div className="schedule-panel"><div className="schedule-head"><div><b>Schedule this Call</b><span>{currentScheduledCall?.status==='scheduled'?'Saved on this device':currentScheduledCall?.status==='delivered'?'Call already delivered':currentScheduledCall?.status==='missed'?'Previous Call was missed':'Choose when AMoment should alert you'}</span></div><span className="timezone-label">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span></div><div className="schedule-controls"><label><span>CALL DATE & TIME</span><input aria-label="Call date and time" type="datetime-local" value={scheduleAt} onChange={e=>setScheduleAt(e.target.value)}/></label><label><span>PREPARATION REMINDER</span><select aria-label="Preparation reminder" value={preparationMinutes} onChange={e=>setPreparationMinutes(Number(e.target.value))}><option value={0}>Off</option><option value={2}>2 minutes before</option><option value={5}>5 minutes before</option><option value={10}>10 minutes before</option><option value={15}>15 minutes before</option></select></label></div><div className="schedule-explainer"><Bell size={14}/><span>Notifications can arrive while this browser is open, including in another tab. Closing the browser stops local reminders.</span></div><button className="button primary" onClick={scheduleCallForTask}>{currentScheduledCall?.status==='scheduled'?'Update scheduled Call':'Schedule this Call'} <AlarmClock size={15}/></button></div><div className="detail-row"><span>First action</span><b>{task.firstAction}</b></div><div className="detail-row"><span>Evidence to prepare</span><b>{task.evidence}</b></div><div className="detail-row"><span>Scheduled Call</span><b>{currentScheduledCall?.status==='scheduled'?new Date(currentScheduledCall.callAt).toLocaleString():currentScheduledCall?.status==='delivered'?'Delivered':'Not scheduled'}</b></div><div className="detail-row"><span>Estimated duration</span><b>{task.duration} minutes</b></div><button className="button secondary" onClick={goCall}><Bell size={16}/> Preview The Call screen</button></section><aside className="panel call-aside"><div className="call-ring"><Bell size={25}/></div><h3>One clear cue.</h3><p>The notification opens this focused in-app Call when you return. Browser notifications don’t take over the screen or interrupt another app.</p><button className="text-button" onClick={()=>setPage('settings')}>Notification settings <ArrowRight size={15}/></button></aside></div>}
      {page==='call'&&<div className="center-stage"><div className="incoming-card"><div className="incoming-kicker"><span className="pulse-dot"/> YOUR MOMENT IS HERE</div><div className="incoming-orb"><Bell size={30}/></div><div className="call-from">AMOMENT <span>· A GENTLE NUDGE</span></div><h2>Time to begin,<br/><em>{task?.title}</em></h2><p>Your first step is ready when you are.</p><div className="call-first-step"><span>START HERE</span><b>{task?.firstAction}</b></div><button className="button primary full" onClick={()=>setPage('evidence')}>I’m ready to start <ArrowRight size={16}/></button><button className="text-button centered" onClick={()=>setPage('task')}><ArrowLeft size={14}/> Not now · review task</button><div className="call-disclaimer">This is a simulated in-app Call, not a cellular call. You may return here from its notification.</div></div></div>}
      {page==='evidence'&&<div className="center-stage"><section className="panel evidence-panel"><div className="panel-icon"><Target size={19}/></div><div className="eyebrow">TASK-START EVIDENCE</div><h2>Show yourself you’re set up.</h2><p>{task?.evidence}</p><div className="demo-proof"><div className="proof-icon">▧</div><div><b>Demo verification</b><span>Use this clearly labelled path to continue your prototype journey.</span></div><span className="demo-tag">DEMO</span></div><div className="honesty-note"><CircleHelp size={15}/> No photo or AI verification is performed. This confirms preparation only.</div><button className="button primary full" onClick={beginTask}>Accept demo evidence <ArrowRight size={16}/></button><button className="text-button centered" onClick={()=>setPage('call')}><ArrowLeft size={14}/> Back to the Call</button></section></div>}
      {page==='lockin'&&<div className="center-stage"><section className="panel lockin-panel"><div className="lockin-top"><div className="lockin-icon"><Timer size={20}/></div><span>FOCUS MOMENT <i/> INTERACTIVE DEMO</span><button className="quiet-icon" onClick={leaveLockin} aria-label="Open emergency exit"><X size={18}/></button></div><div className="lock-ring" style={{'--progress':`${(secs/1800)*100}%`} as React.CSSProperties}><div><span>{String(Math.floor(secs/60)).padStart(2,'0')}:{String(secs%60).padStart(2,'0')}</span><small>remaining</small></div></div><h2>Stay with the next step.</h2><p>{task?.title}</p><div className="lock-tip"><Coffee size={17}/><span>Take it one moment at a time. You can leave whenever you need to.</span></div><button className="button primary" onClick={()=>{if(secs===0)setSecs(1800);setRunning(!running)}}>{running?<><span className="pause-mark">Ⅱ</span> Pause timer</>:<><Play size={15} fill="currentColor"/> {secs===1800?'Start focus timer':'Resume focus timer'}</>}</button><button className="exception-link" onClick={leaveLockin}><ShieldAlert size={15}/> I need to leave · The Exception</button><div className="timer-caveat">This timer is a demonstration. It may pause or reset if you close this browser tab, and it cannot block other apps.</div></section></div>}
      {page==='exception'&&<div className="center-stage"><section className="panel exception-panel"><div className="exception-symbol"><ShieldAlert size={25}/></div><div className="eyebrow">THE EXCEPTION</div><h2>Real life comes first.</h2><p>Leave your focus moment right away. There’s no waiting, proof, or countdown.</p><label className="field-label" htmlFor="return-time">WHEN WOULD YOU LIKE A REMINDER TO RETURN?</label><input id="return-time" type="datetime-local" value={returnAt} onChange={e=>setReturnAt(e.target.value)}/><div className="honesty-note"><Bell size={15}/> The reminder is recorded in this demo; browser notifications are not enabled.</div><button className="button primary full" onClick={submitException}>Leave Lock-In now <ArrowRight size={16}/></button><button className="text-button centered" onClick={()=>setPage('lockin')}><ArrowLeft size={14}/> Return to focus</button></section></div>}
      {page==='analytics'&&<><div className="analytics-intro"><div className="panel-icon"><Compass size={18}/></div><div><b>Your data stays yours.</b><p>These numbers come from actions recorded in this local demo.</p></div></div><div className="stats-grid"><div className="panel stat-card"><span>PLANS CONFIRMED</span><b>{events.filter(e=>e.type==='task-created').length+(tasks.filter(t=>t.id.startsWith('demo-')).length)}</b><small>including the sample task</small></div><div className="panel stat-card"><span>TASK STARTS</span><b>{events.filter(e=>e.type==='task-started').length}</b><small>demo evidence accepted</small></div><div className="panel stat-card"><span>FOCUS SESSIONS</span><b>{events.filter(e=>e.type==='focus-completed').length}</b><small>completed in this demo</small></div><div className="panel stat-card"><span>EXCEPTIONS USED</span><b>{events.filter(e=>e.type==='exception-used').length}</b><small>return reminders recorded</small></div></div><section className="panel activity-panel"><div className="section-title compact"><div><h3>Recent activity</h3><p>Only actions from this browser appear here.</p></div></div>{events.length===0?<div className="empty-activity">Nothing recorded yet. Your progress will show here as you use AMoment.</div>:<div className="activity-list">{[...events].reverse().map((e,i)=><div className="activity-row" key={i}><div className="activity-check"><Check size={14}/></div><div><b>{e.type.replace(/-/g,' ')}</b><span>{e.task||'AMoment'} {e.note?` · return ${new Date(e.note).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`:''}</span></div><time>{new Date(e.at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</time></div>)}</div>}</section><div className="sample-note"><CircleHelp size={15}/> The sample commitment on your dashboard is labelled demo data and is not included as a user task-start or completion.</div></>}
      {page==='universe'&&<><div className="universe-intro"><div><div className="eyebrow">SMALL STEPS SHAPE A PLACE</div><h2>Three quiet worlds.<br/>Every beginning leaves a mark.</h2><p>Real task starts and completed focus moments nurture these settlements. Your demo journey is local to this browser.</p></div><div className="universe-star">✳</div></div><div className="settlements">{settlements.map((s,i)=><article className={`settlement ${s.color}`} key={s.name}><div className="settlement-sky"><span className="settlement-number">0{i+1}</span><div className="settlement-orbit orbit-one"/><div className="settlement-orbit orbit-two"/><div className="settlement-planet"><i className="continent continent-one"/><i className="continent continent-two"/><i className="settlement-moon"/></div><div className="settlement-ridge ridge-one"/><div className="settlement-ridge ridge-two"/><div className="settlement-name">{s.name}</div></div><div className="settlement-info"><div><h3>{s.name}</h3><p>{s.subtitle}</p></div><span className="free-label">FREE</span></div><div className="settlement-progress"><span>WORLD GROWTH</span><b>{s.progress + (events.filter(e=>e.type==='task-started'||e.type==='focus-completed').length*2)}%</b></div><div className="progress-track"><i style={{width:`${Math.min(100,s.progress + events.filter(e=>e.type==='task-started'||e.type==='focus-completed').length*2)}%`}}/></div></article>)}</div><button className="locked-world" onClick={()=>setPage('premium')}><span className="locked-world-art" aria-hidden="true"><i/><b/><em/></span><span className="locked-world-copy"><small>BEYOND THE KNOWN ORBIT</small><strong>A fourth world is calling.</strong><span>Unlock new places, stories, and ways to make the universe yours.</span></span><span className="locked-world-cta">VIEW EXPANSION <ArrowRight size={14}/></span></button><div className="universe-foot"><Sparkles size={16}/><span>Progress is earned through task starts and focus follow-through. Decorative growth is a demo representation.</span></div></>}
      {page==='premium'&&<><div className="premium-hero"><div className="premium-art"><div className="planet p1"/><div className="planet p2"/><div className="planet p3"/><div className="orbit o1"/><div className="orbit o2"/><span>✦</span></div><div className="eyebrow">A ONE-TIME UNIVERSE EXPANSION</div><h2>Let your world<br/>grow a little wider.</h2><p>New places to discover, each one shaped by the real steps you take.</p><div className="premium-price">Coming in a later phase <span>· no purchase available</span></div><button className="button primary" onClick={()=>setPage('checkout')}><Sparkles size={16}/> Explore the expansion</button></div><div className="premium-features"><div><span>01</span><b>New settlements</b><p>Visit original places beyond the free worlds.</p></div><div><span>02</span><b>Stories & characters</b><p>Meet the lives unfolding across your universe.</p></div><div><span>03</span><b>Make it yours</b><p>Personalize your world with thoughtful details.</p></div></div><div className="free-promise"><Check size={16}/> Task planning, Calls, task-start evidence, Lock-In, the Exception, and essential analytics stay free.</div></>}
      {page==='checkout'&&<div className="center-stage"><section className="panel evidence-panel checkout-panel"><div className="panel-icon"><CreditCard size={19}/></div><div className="eyebrow">PAYPAL SANDBOX · LATER PHASE</div><h2>Checkout is not connected.</h2><p>There is no purchase flow in this Phase 1 prototype. Premium access will only unlock after a server verifies a successful sandbox order capture.</p><div className="honesty-note"><ShieldAlert size={16}/> No payment will be taken and no universe content is unlocked.</div><button className="button secondary full" onClick={()=>setPage('premium')}><ArrowLeft size={15}/> Back to expansion</button></section></div>}
      {page==='settings'&&<div className="settings-layout"><section className="panel settings-panel"><h3>Appearance</h3><p>Choose a look that feels comfortable to return to.</p><div className="setting-row"><div><b>Theme</b><span>Your choice is saved in this browser.</span></div><div className="theme-switch"><button className={theme==='light'?'chosen':''} onClick={()=>setTheme('light')}><Sun size={15}/> Cozy light</button><button className={theme==='dark'?'chosen':''} onClick={()=>setTheme('dark')}><Moon size={15}/> Refined dark</button></div></div><div className="setting-row"><div><b>Call sound</b><span>{sound?'Enabled in this browser. You enabled it with a page interaction.':'Off. Turn it on here to unlock sound playback.'}</span></div><button className={`toggle ${sound?'on':''}`} role="switch" aria-checked={sound} aria-label="Call sound" onClick={enableCallSound}><i/></button></div></section><section className="panel settings-panel"><h3>Browser notifications</h3><p>AMoment needs permission to show your scheduled Calls on the desktop while this browser is running.</p><div className="permission-row"><span className={`permission-indicator ${permission==='granted'?'granted':permission==='denied'?'denied':''}`}><i/>{permission==='granted'?'ALLOWED':permission==='denied'?'BLOCKED':permission==='unsupported'?'UNSUPPORTED':'NOT YET ALLOWED'}</span><span className="permission-copy">{permission==='granted'?'Notifications are enabled for this site.':permission==='denied'?'This site is blocked from showing notifications. Change the site permission in your browser settings.':permission==='unsupported'?'This browser does not provide the Notifications API.':'Allow notifications to receive reminders while using another tab.'}</span>{permission!=='granted'&&permission!=='unsupported'&&<button className="button secondary" onClick={async()=>{const result=await askNotificationPermission();setNotice(result==='granted'?'Browser notifications are enabled.':result==='denied'?'Permission is blocked. Use the site settings instructions below.':'No permission was granted.')}}>{permission==='denied'?'Check permission again':'Enable notifications'} <Bell size={14}/></button>}</div>{permission==='denied'&&<div className="permission-instructions"><b>To allow notifications</b><span>Open the site controls beside the address bar → Site permissions → Notifications → Allow, then return here and reload the page.</span></div>}<div className="schedule-explainer"><CircleHelp size={14}/><span>Calls are checked while this page is open, including in a background tab. If the browser is closed, reminders stop. This is not push notification delivery.</span></div><div className="test-call-row"><div><b>TEST CALL</b><span>{scheduledCalls.some(call=>call.test&&call.status==='scheduled')?'A test notification is queued.':'Schedule a test notification for about 10 seconds from now.'}</span></div><button className="button primary" onClick={startTestCall}>{scheduledCalls.some(call=>call.test&&call.status==='scheduled')?'Cancel test':'TEST CALL · 10 SEC'} <Bell size={15}/></button></div><div className="setting-row"><div><b>Scheduled Calls saved</b><span>Stored in this browser and kept after refresh.</span></div><b className="schedule-count">{scheduledCalls.filter(call=>call.status==='scheduled'&&!call.test).length}</b></div></section><section className="panel settings-panel"><h3>Reminders & privacy</h3><p>Understand the limits of browser scheduling.</p><div className="setting-row"><div><b>Missed Calls</b><span>Calls more than 30 minutes late are marked missed instead of shown as stale alerts.</span></div><span className="not-ready">LOCAL ONLY</span></div><div className="setting-row"><div><b>Demo data</b><span>Plans, reminder schedules, and events are stored locally in this browser.</span></div><button className="text-button" onClick={()=>{localStorage.removeItem('amoment-tasks');localStorage.removeItem('amoment-events');localStorage.removeItem('amoment-scheduled-calls');setTasks(DEMO);setEvents([]);setScheduledCalls([]);setTaskId(DEMO[0].id);setNotice('Local demo data reset.')}}>Reset demo</button></div><div className="setting-row"><div><b>Future integrations</b><span>AI planning, PayPal checkout, native Android controls</span></div><span className="not-ready">NOT CONNECTED</span></div></section></div>}
      </div>
    </main>
  </div>;
}
