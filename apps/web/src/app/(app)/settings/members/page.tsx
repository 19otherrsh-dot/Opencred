'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useMutation } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { formatDateShort } from '@/lib/format';
import {
  Banner,
  Button,
  Card,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  Select,
  SkeletonRows,
} from '@/components/ui';

interface Member {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'issuer' | 'viewer';
  acceptedAt: string | null;
  lastLoginAt: string | null;
  pending: boolean;
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: 'Everything, including billing and deleting the workspace.',
  admin: 'Everything except billing and deleting the workspace.',
  issuer: 'Create and revoke credentials, edit templates. No settings, no billing.',
  viewer: 'Read-only. Can see credentials and analytics, cannot issue anything.',
};

export default function MembersSettingsPage() {
  const { can, session } = useAuth();
  const members = useApi<Member[]>('/v1/org/members');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ email: '', name: '', role: 'issuer' });

  const sendInvite = useMutation(async () => {
    await api.post('/v1/org/members', invite);
    setInviteOpen(false);
    setInvite({ email: '', name: '', role: 'issuer' });
    members.reload();
  });

  const changeRole = useMutation(async (id: string, role: string) => {
    await api.patch(`/v1/org/members/${id}`, { role });
    members.reload();
  });

  const remove = useMutation(async (id: string) => {
    await api.delete(`/v1/org/members/${id}`);
    members.reload();
  });

  return (
    <div className="stack">
      <Card
        title="Team"
        description="Roles are enforced by the API, not just hidden in this interface."
        action={
          can('members:manage') ? (
            <Button variant="primary" onClick={() => setInviteOpen(true)}>
              Invite someone
            </Button>
          ) : undefined
        }
      >
        {members.error && <ErrorNotice error={members.error} />}
        {changeRole.error && <ErrorNotice error={changeRole.error} />}
        {remove.error && <ErrorNotice error={remove.error} />}

        {members.loading ? (
          <SkeletonRows rows={3} />
        ) : (
          <div className="table-wrap" style={{ border: 0 }}>
            <table className="table">
              <caption className="sr-only">Workspace members</caption>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Role</th>
                  <th scope="col">Last seen</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.data?.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <strong>{member.name}</strong>
                      {member.userId === session?.user.id && (
                        <span className="badge badge-neutral" style={{ marginLeft: 6 }}>
                          You
                        </span>
                      )}
                      {member.pending && (
                        <span className="badge badge-warn" style={{ marginLeft: 6 }}>
                          Invited
                        </span>
                      )}
                      <div className="subtle">{member.email}</div>
                    </td>
                    <td>
                      {can('members:manage') ? (
                        <Select
                          value={member.role}
                          aria-label={`Role for ${member.name}`}
                          onChange={(e) => void changeRole.run(member.id, e.target.value)}
                          style={{ maxWidth: 140 }}
                        >
                          <option value="owner">Owner</option>
                          <option value="admin">Admin</option>
                          <option value="issuer">Issuer</option>
                          <option value="viewer">Viewer</option>
                        </Select>
                      ) : (
                        <span className="badge badge-neutral">{member.role}</span>
                      )}
                    </td>
                    <td className="subtle">
                      {member.lastLoginAt ? formatDateShort(member.lastLoginAt) : 'never'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {can('members:manage') && member.userId !== session?.user.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void remove.run(member.id)}
                          style={{ color: 'var(--danger)' }}
                        >
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="What each role can do">
        <dl className="kv">
          {Object.entries(ROLE_DESCRIPTIONS).map(([role, description]) => (
            <div key={role} style={{ display: 'contents' }}>
              <dt style={{ textTransform: 'capitalize' }}>{role}</dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite someone"
        footer={
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={sendInvite.busy} onClick={() => void sendInvite.run()}>
              Send invitation
            </Button>
          </div>
        }
      >
        <div className="stack">
          {sendInvite.error && <ErrorNotice error={sendInvite.error} />}

          <Field label="Email" required>
            {(props) => (
              <Input
                {...props}
                type="email"
                value={invite.email}
                onChange={(e) => setInvite({ ...invite, email: e.target.value })}
                required
              />
            )}
          </Field>

          <Field label="Name">
            {(props) => (
              <Input
                {...props}
                value={invite.name}
                onChange={(e) => setInvite({ ...invite, name: e.target.value })}
              />
            )}
          </Field>

          <Field label="Role" hint={ROLE_DESCRIPTIONS[invite.role]}>
            {(props) => (
              <Select
                {...props}
                value={invite.role}
                onChange={(e) => setInvite({ ...invite, role: e.target.value })}
              >
                <option value="viewer">Viewer</option>
                <option value="issuer">Issuer</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </Select>
            )}
          </Field>

          <Banner tone="info">
            They will get an email with a single-use link, valid for seven days, to set a password.
          </Banner>
        </div>
      </Dialog>
    </div>
  );
}
