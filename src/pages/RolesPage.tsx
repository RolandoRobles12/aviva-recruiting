import { useState, useEffect } from 'react';
import { Lock, Save, Users, Shield, Check, ChevronRight } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import {
  getRolePermissions,
  updateRolePermissions,
  getAllRecruiters,
  updateUserRole,
  countByRole,
} from '../services/roles';
import {
  PERMISSION_GROUPS,
  ROLE_DEFAULTS,
  ROLE_META,
  ROLE_ORDER,
  normalizeRole,
  type RoleType,
  type RolePermissions,
  type PermissionKey,
} from '../types/permissions';
import type { RecruiterProfile } from '../types';

// ─── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
        checked ? 'bg-primary-600' : 'bg-gray-200'
      } ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

// ─── Role color dot ────────────────────────────────────────────────────────────

const COLOR_CLASSES: Record<string, string> = {
  blue:   'bg-blue-500',
  purple: 'bg-purple-500',
  green:  'bg-green-500',
  amber:  'bg-amber-500',
  red:    'bg-red-500',
};

function RoleDot({ color }: { color: string }) {
  return <span className={`w-2 h-2 rounded-full shrink-0 ${COLOR_CLASSES[color] ?? 'bg-gray-400'}`} />;
}

// ─── Role badge (for Users tab) ────────────────────────────────────────────────

const BADGE_CLASSES: Record<string, string> = {
  blue:   'bg-blue-50 text-blue-700 ring-blue-200',
  purple: 'bg-purple-50 text-purple-700 ring-purple-200',
  green:  'bg-green-50 text-green-700 ring-green-200',
  amber:  'bg-amber-50 text-amber-700 ring-amber-200',
  red:    'bg-red-50 text-red-700 ring-red-200',
};

function RoleBadge({ role }: { role: RoleType }) {
  const meta = ROLE_META[role];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ${
        BADGE_CLASSES[meta.color] ?? 'bg-gray-50 text-gray-700 ring-gray-200'
      }`}
    >
      {meta.label}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROLES TAB
// ═══════════════════════════════════════════════════════════════════════════════

function RolesTab() {
  const [selected, setSelected] = useState<RoleType>('reclutador');
  const [perms, setPerms] = useState<RolePermissions>(ROLE_DEFAULTS.reclutador);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [userCounts, setUserCounts] = useState<Record<string, number>>({});

  // Load user counts once
  useEffect(() => {
    getAllRecruiters()
      .then((recruiters) => setUserCounts(countByRole(recruiters)))
      .catch(() => {});
  }, []);

  // Load permissions when role changes
  useEffect(() => {
    setDirty(false);
    setSaved(false);
    getRolePermissions(selected).then(setPerms).catch(() => {
      setPerms(ROLE_DEFAULTS[selected]);
    });
  }, [selected]);

  const toggle = (key: PermissionKey) => {
    if (selected === 'admin') return;
    setPerms((prev) => ({ ...prev, [key]: !prev[key] }));
    setDirty(true);
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateRolePermissions(selected, perms);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error('[RolesPage] save error:', err);
    } finally {
      setSaving(false);
    }
  };

  const isAdmin = selected === 'admin';

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: role list ─────────────────────────────────── */}
      <aside className="w-52 shrink-0 border-r border-gray-100 bg-white overflow-y-auto py-2">
        {ROLE_ORDER.map((role) => {
          const meta = ROLE_META[role];
          const count = userCounts[role] ?? 0;
          const active = selected === role;
          return (
            <button
              key={role}
              onClick={() => setSelected(role)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                active
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <RoleDot color={meta.color} />
              <span className="flex-1 text-sm font-medium truncate">{meta.label}</span>
              <span className="text-xs text-gray-400">{count}</span>
              {active && <ChevronRight size={13} className="shrink-0 text-primary-500" />}
            </button>
          );
        })}
      </aside>

      {/* ── Right: permission editor ─────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-white">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="text-base font-semibold text-gray-900">{ROLE_META[selected].label}</h3>
              {isAdmin && (
                <span className="flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full font-medium">
                  <Lock size={10} /> Sin restricciones
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500">{ROLE_META[selected].description}</p>
          </div>
          {!isAdmin && (
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 ${
                saved
                  ? 'bg-green-50 text-green-700'
                  : dirty
                  ? 'bg-primary-600 text-white hover:bg-primary-700'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              {saved ? (
                <><Check size={13} /> Guardado</>
              ) : saving ? (
                <><div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> Guardando...</>
              ) : (
                <><Save size={13} /> Guardar cambios</>
              )}
            </button>
          )}
        </div>

        {/* Admin notice */}
        {isAdmin && (
          <div className="mx-6 mt-4 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <Lock size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              El rol <strong>Admin</strong> siempre tiene acceso total al sistema. Sus permisos no se pueden modificar.
            </p>
          </div>
        )}

        {/* Permission groups */}
        <div className="px-6 py-4 space-y-8">
          {PERMISSION_GROUPS.map((group) => (
            <div key={group.id}>
              <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
                {group.label}
              </h4>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <label
                    key={item.key}
                    className={`flex items-center justify-between gap-4 p-3 rounded-xl transition-colors ${
                      isAdmin
                        ? 'bg-gray-50 opacity-60'
                        : 'bg-gray-50 hover:bg-gray-100 cursor-pointer'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{item.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
                    </div>
                    <Toggle
                      checked={perms[item.key]}
                      onChange={() => toggle(item.key)}
                      disabled={isAdmin}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// USERS TAB
// ═══════════════════════════════════════════════════════════════════════════════

function UsersTab() {
  const [recruiters, setRecruiters] = useState<RecruiterProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUid, setSavingUid] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    getAllRecruiters()
      .then(setRecruiters)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleRoleChange = async (uid: string, newRole: RoleType) => {
    setSavingUid(uid);
    try {
      await updateUserRole(uid, newRole);
      setRecruiters((prev) =>
        prev.map((r) => (r.uid === uid ? { ...r, role: newRole } : r))
      );
    } catch (err) {
      console.error('[UsersTab] role change error:', err);
    } finally {
      setSavingUid(null);
    }
  };

  const filtered = recruiters.filter((r) => {
    const q = search.toLowerCase();
    return (
      !q ||
      r.displayName.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q)
    );
  });

  return (
    // The page shell keeps overflow hidden so the Roles tab can run its own
    // two-pane scroll, which means this tab has to scroll itself — without it
    // the user list was simply cut off with no way to reach the rest.
    <div className="h-full overflow-y-auto p-6 bg-white">
      {/* Search */}
      <div className="mb-5 max-w-sm">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar usuario..."
          className="input-field text-sm"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No se encontraron usuarios.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-left">
                <th className="px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Usuario
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">
                  Correo
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Rol actual
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Cambiar rol
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((r) => {
                const currentRole = normalizeRole(r.role as Parameters<typeof normalizeRole>[0]);
                return (
                  <tr key={r.uid} className="hover:bg-gray-50 transition-colors">
                    {/* Avatar + name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {r.photoUrl ? (
                          <img src={r.photoUrl} alt="" className="w-8 h-8 rounded-full shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                            <span className="text-primary-700 text-xs font-semibold">
                              {r.displayName?.[0] ?? '?'}
                            </span>
                          </div>
                        )}
                        <span className="text-sm font-medium text-gray-900">{r.displayName}</span>
                      </div>
                    </td>

                    {/* Email */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-sm text-gray-500">{r.email}</span>
                    </td>

                    {/* Current role badge */}
                    <td className="px-4 py-3">
                      <RoleBadge role={currentRole} />
                    </td>

                    {/* Role selector */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={currentRole}
                          onChange={(e) => handleRoleChange(r.uid, e.target.value as RoleType)}
                          disabled={savingUid === r.uid}
                          className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                        >
                          {ROLE_ORDER.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_META[role].label}
                            </option>
                          ))}
                        </select>
                        {savingUid === r.uid && (
                          <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════════════

type TabId = 'users' | 'roles';

export function RolesPage() {
  // Users first: managing who has access is the everyday task; editing what a
  // role can do is occasional.
  const [tab, setTab] = useState<TabId>('users');

  return (
    <DashboardLayout>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-100 bg-white shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={16} className="text-primary-600" />
            <h2 className="text-base font-semibold text-gray-900">Roles y Permisos</h2>
          </div>

          {/* Tabs */}
          <div className="flex gap-1">
            {([
              { id: 'users', label: 'Usuarios', icon: <Users size={13} /> },
              { id: 'roles', label: 'Roles', icon: <Shield size={13} /> },
            ] as { id: TabId; label: string; icon: React.ReactNode }[]).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden">
          {tab === 'roles' ? <RolesTab /> : <UsersTab />}
        </div>
      </div>
    </DashboardLayout>
  );
}
