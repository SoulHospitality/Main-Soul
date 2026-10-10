import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Sliders, Shield, MessageSquare, Zap, Clock, Link2, Plus, Trash2, CheckCircle,
  Copy, Bot, AlertTriangle, Save, RefreshCw, Users, Lock, Sparkles, Key
} from 'lucide-react';
import { inboxApi, errorMessage } from '../inbox/api';
import { useInbox } from '../inbox/InboxContext';

export default function InboxSettingsPage() {
  const { me, can } = useInbox();
  const [activeTab, setActiveTab] = useState('settings');

  // Fetch Settings
  const { data: settingsData, refetch: refetchSettings } = useQuery({
    queryKey: ['inbox-settings'],
    queryFn: () => inboxApi.get('/admin/settings'),
    enabled: can('settings.manage'),
  });

  // Fetch Team Agents
  const { data: teamData, refetch: refetchTeam } = useQuery({
    queryKey: ['inbox-team'],
    queryFn: () => inboxApi.get('/admin/team'),
    enabled: can('users.manage'),
  });

  // Fetch Channels
  const { data: channelsData, refetch: refetchChannels } = useQuery({
    queryKey: ['inbox-channels'],
    queryFn: () => inboxApi.get('/admin/channels'),
    enabled: can('channels.manage'),
  });

  // Fetch Quick Replies
  const { data: quickReplies = [], refetch: refetchQuickReplies } = useQuery({
    queryKey: ['inbox-quick-replies-admin'],
    queryFn: () => inboxApi.get('/admin/quick-replies'),
    enabled: can('templates.manage'),
  });

  const settings = settingsData?.settings || {};
  const webhook = settingsData?.webhook || {};

  const [savingSettings, setSavingSettings] = useState(false);
  const [formSettings, setFormSettings] = useState(null);

  // Initialize form settings when loaded
  if (settingsData?.settings && !formSettings) {
    setFormSettings(settingsData.settings);
  }

  const handleSaveSettings = async (e) => {
    e?.preventDefault();
    if (!formSettings) return;
    setSavingSettings(true);
    try {
      await inboxApi.put('/admin/settings', formSettings);
      toast.success('Inbox settings saved successfully!');
      refetchSettings();
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save settings'));
    } finally {
      setSavingSettings(false);
    }
  };

  const handleUpdateAgent = async (userId, patch) => {
    try {
      await inboxApi.patch(`/admin/team/${userId}`, patch);
      toast.success('Agent updated');
      refetchTeam();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard!');
  };

  return (
    <div className="pms-shell min-h-screen bg-slate-50 p-6 space-y-6 font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Sliders className="w-6 h-6 text-soul-blue" />
            Omnichannel & SLA Settings
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Configure Meta webhooks (WhatsApp/Instagram/Messenger), SLA targets, business hours, AI auto-replies, team rotation, and quick replies.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 text-xs font-bold">
        {[
          { id: 'settings', label: 'SLA & Business Hours', icon: Clock, perm: 'settings.manage' },
          { id: 'channels', label: 'Meta Channels & Webhooks', icon: Link2, perm: 'channels.manage' },
          { id: 'team', label: 'Agent Rotation & Limits', icon: Users, perm: 'users.manage' },
          { id: 'replies', label: 'Quick Replies & Templates', icon: MessageSquare, perm: 'templates.manage' },
        ].map((tab) => {
          if (!can(tab.perm)) return null;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-3 border-b-2 transition-all ${
                activeTab === tab.id
                  ? 'border-soul-blue text-soul-blue'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}

      {/* Tab 1: SLA & Business Hours */}
      {activeTab === 'settings' && formSettings && (
        <form onSubmit={handleSaveSettings} className="space-y-6 max-w-4xl text-xs">
          {/* SLA Thresholds Card */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-soul-blue" />
              SLA Response Targets (Business Hours)
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Target Response Time (Minutes)</label>
                <input
                  type="number"
                  min={1}
                  max={600}
                  value={formSettings.sla_target_min || 15}
                  onChange={(e) => setFormSettings({ ...formSettings, sla_target_min: Number(e.target.value) })}
                  className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50"
                  required
                />
                <span className="text-[11px] text-slate-400 mt-1 block">Staff must respond to new customer messages within this window.</span>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Warning Warning Threshold (Minutes)</label>
                <input
                  type="number"
                  min={1}
                  max={600}
                  value={formSettings.sla_warning_min || 10}
                  onChange={(e) => setFormSettings({ ...formSettings, sla_warning_min: Number(e.target.value) })}
                  className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50"
                  required
                />
                <span className="text-[11px] text-slate-400 mt-1 block">Yellow warning state triggers when remaining time drops below this.</span>
              </div>
            </div>
          </div>

          {/* Business Hours & Night Mode */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              Working Hours & Night AI Auto-Replies
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Business Day Start Time (Cairo HH:MM)</label>
                <input
                  type="text"
                  value={formSettings.business_start || '09:00'}
                  onChange={(e) => setFormSettings({ ...formSettings, business_start: e.target.value })}
                  className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50"
                  placeholder="09:00"
                  required
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Business Day End Time (Cairo HH:MM)</label>
                <input
                  type="text"
                  value={formSettings.business_end || '23:00'}
                  onChange={(e) => setFormSettings({ ...formSettings, business_end: e.target.value })}
                  className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50"
                  placeholder="23:00"
                  required
                />
              </div>
            </div>

            <div className="pt-2">
              <label className="block font-bold text-slate-700 mb-1">After-Hours / Night Mode behavior</label>
              <select
                value={formSettings.night_mode || 'ai'}
                onChange={(e) => setFormSettings({ ...formSettings, night_mode: e.target.value })}
                className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50"
              >
                <option value="ai">AI Assistant responds automatically outside business hours</option>
                <option value="message">Send fixed after-hours automated text message</option>
                <option value="off">Off (Leave unreplied until morning opening)</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingSettings}
              className="px-6 py-3 bg-soul-blue hover:bg-soul-blue-dark text-white font-bold rounded-xl shadow transition-all flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {savingSettings ? 'Saving Settings…' : 'Save Settings'}
            </button>
          </div>
        </form>
      )}

      {/* Tab 2: Meta Channels & Webhooks */}
      {activeTab === 'channels' && (
        <div className="space-y-6 max-w-4xl text-xs">
          {/* Webhook Endpoint Configuration Information */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Link2 className="w-4 h-4 text-soul-blue" />
              Meta App Webhook Configuration
            </h2>
            <p className="text-slate-500">
              Set these credentials in Meta Developers Dashboard under Facebook / WhatsApp / Instagram Webhooks.
            </p>

            <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200 font-mono">
              <div>
                <span className="text-slate-400 block text-[10px] font-sans font-bold uppercase">Webhook URL</span>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <span className="text-slate-800 font-bold select-all">{webhook.url}</span>
                  <button type="button" onClick={() => copyToClipboard(webhook.url)} className="p-1 rounded text-slate-500 hover:text-slate-800">
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200">
                <span className="text-slate-400 block text-[10px] font-sans font-bold uppercase">Meta App Secret & Verify Token Status</span>
                <div className="flex items-center gap-4 text-xs font-sans mt-1">
                  <span className={`inline-flex items-center gap-1 font-bold ${webhook.appSecretSet ? 'text-emerald-600' : 'text-rose-600'}`}>
                    <CheckCircle className="w-3.5 h-3.5" />
                    META_APP_SECRET: {webhook.appSecretSet ? 'Set' : 'Missing'}
                  </span>
                  <span className={`inline-flex items-center gap-1 font-bold ${webhook.verifyTokenSet ? 'text-emerald-600' : 'text-rose-600'}`}>
                    <CheckCircle className="w-3.5 h-3.5" />
                    META_VERIFY_TOKEN: {webhook.verifyTokenSet ? 'Set' : 'Missing'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Connected Channels Stream */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-sm font-bold text-slate-900">Connected Channels</h2>
            {(channelsData?.items || []).length === 0 ? (
              <div className="p-8 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
                No active Meta channels connected yet. Add WhatsApp WABA, Facebook Page, or Instagram account credentials.
              </div>
            ) : (
              <div className="space-y-2">
                {(channelsData?.items || []).map((ch) => (
                  <div key={ch.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900 capitalize">{ch.kind} — {ch.name}</h4>
                      <span className="text-[11px] text-slate-400 font-mono">External ID: {ch.external_id}</span>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">Active</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Agent Team Rotation */}
      {activeTab === 'team' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden text-xs max-w-5xl">
          <div className="p-5 border-b border-slate-200">
            <h2 className="font-bold text-sm text-slate-900">Inbox Staff & Auto-Assignment Rotation</h2>
            <p className="text-slate-500 text-xs mt-0.5">Manage which staff members receive auto-routed customer conversations and their max chat limits.</p>
          </div>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold text-[11px] uppercase tracking-wider">
                <th className="p-3">Staff Member</th>
                <th className="p-3">PMS Role</th>
                <th className="p-3">Inbox Role</th>
                <th className="p-3">In Auto Rotation</th>
                <th className="p-3">Max Open Chats</th>
                <th className="p-3">Active Open Chats</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(teamData?.items || []).map((u) => (
                <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="p-3 font-bold text-slate-900">{u.name}</td>
                  <td className="p-3 text-slate-500 capitalize">{u.pms_role}</td>
                  <td className="p-3 font-medium">
                    <select
                      value={u.role_override || 'default'}
                      onChange={(e) => handleUpdateAgent(u.id, { inbox_role: e.target.value })}
                      className="p-1 border border-slate-200 rounded bg-white font-medium"
                    >
                      <option value="default">Default ({u.role || 'none'})</option>
                      <option value="agent">Agent</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="manager">Manager</option>
                    </select>
                  </td>
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={Boolean(u.in_rotation)}
                      onChange={(e) => handleUpdateAgent(u.id, { in_rotation: e.target.checked })}
                      className="w-4 h-4 accent-soul-blue rounded"
                    />
                  </td>
                  <td className="p-3">
                    <input
                      type="number"
                      min={1}
                      max={200}
                      defaultValue={u.max_open || 30}
                      onBlur={(e) => handleUpdateAgent(u.id, { max_open: Number(e.target.value) })}
                      className="w-16 p-1 border border-slate-200 rounded text-center bg-white"
                    />
                  </td>
                  <td className="p-3 font-bold text-slate-700">
                    {u.open || 0} / {u.max_open || 30}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 4: Quick Replies */}
      {activeTab === 'replies' && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 max-w-4xl text-xs">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm text-slate-900">Canned Quick Replies</h2>
          </div>
          <div className="space-y-2">
            {quickReplies.map((qr) => (
              <div key={qr.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-start justify-between gap-4">
                <div>
                  <h4 className="font-bold text-slate-800">{qr.title || qr.shortcut}</h4>
                  <p className="text-slate-600 mt-1 whitespace-pre-wrap">{qr.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
