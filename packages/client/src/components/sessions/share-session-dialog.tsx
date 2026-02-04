import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  useSessionParticipants,
  useAddParticipant,
  useRemoveParticipant,
  useSessionShareLinks,
  useCreateShareLink,
  useRevokeShareLink,
} from '@/api/sessions';
import { toastSuccess, toastError } from '@/hooks/use-toast';
import type { SessionParticipant, SessionShareLink } from '@/api/types';

interface ShareSessionDialogProps {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isOwner: boolean;
}

export function ShareSessionDialog({
  sessionId,
  open,
  onOpenChange,
  isOwner,
}: ShareSessionDialogProps) {
  const [tab, setTab] = useState('links');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark:border-neutral-800 dark:bg-neutral-900">
        <DialogHeader>
          <DialogTitle className="dark:text-neutral-100">Share Session</DialogTitle>
          <DialogDescription className="dark:text-neutral-400">
            Invite others to view or collaborate on this session.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="dark:bg-neutral-800">
            <TabsTrigger value="links" className="dark:data-[state=active]:bg-neutral-700 dark:text-neutral-300">
              Links
            </TabsTrigger>
            <TabsTrigger value="people" className="dark:data-[state=active]:bg-neutral-700 dark:text-neutral-300">
              People
            </TabsTrigger>
          </TabsList>
          <TabsContent value="links">
            <LinksTab sessionId={sessionId} isOwner={isOwner} />
          </TabsContent>
          <TabsContent value="people">
            <PeopleTab sessionId={sessionId} isOwner={isOwner} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function LinksTab({ sessionId, isOwner }: { sessionId: string; isOwner: boolean }) {
  const { data: shareLinks, isLoading } = useSessionShareLinks(sessionId);
  const createLink = useCreateShareLink();

  const handleCreate = async () => {
    try {
      const result = await createLink.mutateAsync({ sessionId, role: 'collaborator' });
      const url = `${window.location.origin}/sessions/join/${result.shareLink.token}`;
      await navigator.clipboard.writeText(url);
      toastSuccess('Link copied', 'Share link copied to clipboard');
    } catch {
      toastError('Failed to create link', 'Could not create share link');
    }
  };

  if (!isOwner) {
    return (
      <p className="py-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Only the session owner can create share links.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Button
        size="sm"
        onClick={handleCreate}
        disabled={createLink.isPending}
        className="w-full"
      >
        {createLink.isPending ? 'Creating...' : 'Create Link'}
      </Button>
      {isLoading ? (
        <p className="text-center text-xs text-neutral-400">Loading...</p>
      ) : shareLinks && shareLinks.length > 0 ? (
        <div className="space-y-2">
          {shareLinks.map((link) => (
            <ShareLinkRow key={link.id} link={link} sessionId={sessionId} />
          ))}
        </div>
      ) : (
        <p className="py-2 text-center text-xs text-neutral-400 dark:text-neutral-500">
          No active share links.
        </p>
      )}
    </div>
  );
}

function ShareLinkRow({ link, sessionId }: { link: SessionShareLink; sessionId: string }) {
  const revokeLink = useRevokeShareLink();

  const handleCopy = async () => {
    const url = `${window.location.origin}/sessions/join/${link.token}`;
    await navigator.clipboard.writeText(url);
    toastSuccess('Copied', 'Link copied to clipboard');
  };

  const handleRevoke = async () => {
    try {
      await revokeLink.mutateAsync({ sessionId, linkId: link.id });
      toastSuccess('Revoked', 'Share link has been revoked');
    } catch {
      toastError('Failed', 'Could not revoke share link');
    }
  };

  const isExpired = link.expiresAt && new Date(link.expiresAt) < new Date();
  const isExhausted = link.maxUses != null && link.useCount >= link.maxUses;

  return (
    <div className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800">
      <div className="flex items-center gap-2 min-w-0">
        <Badge variant={link.role === 'collaborator' ? 'default' : 'secondary'}>
          {link.role}
        </Badge>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {link.useCount} use{link.useCount !== 1 ? 's' : ''}
          {link.maxUses != null && ` / ${link.maxUses}`}
        </span>
        {link.expiresAt && (
          <span className="text-xs text-neutral-400 dark:text-neutral-500">
            {isExpired ? 'expired' : `expires ${formatRelative(new Date(link.expiresAt))}`}
          </span>
        )}
        {isExhausted && (
          <span className="text-xs text-amber-500">exhausted</span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-6 px-2 text-xs"
          disabled={!!isExpired || isExhausted}
        >
          Copy
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRevoke}
          disabled={revokeLink.isPending}
          className="h-6 px-2 text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
        >
          Revoke
        </Button>
      </div>
    </div>
  );
}

function PeopleTab({ sessionId, isOwner }: { sessionId: string; isOwner: boolean }) {
  const { data: participants, isLoading } = useSessionParticipants(sessionId);
  const addParticipant = useAddParticipant();
  const [email, setEmail] = useState('');

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    try {
      await addParticipant.mutateAsync({ sessionId, email: trimmed, role: 'collaborator' });
      setEmail('');
      toastSuccess('Added', `${trimmed} has been added`);
    } catch {
      toastError('Failed', 'Could not add participant');
    }
  };

  return (
    <div className="space-y-3">
      {isOwner && (
        <form onSubmit={handleAdd} className="flex gap-2">
          <Input
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            className="h-8 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />
          <Button size="sm" type="submit" disabled={addParticipant.isPending || !email.trim()} className="h-8 shrink-0">
            Add
          </Button>
        </form>
      )}
      {isLoading ? (
        <p className="text-center text-xs text-neutral-400">Loading...</p>
      ) : participants && participants.length > 0 ? (
        <div className="space-y-1">
          {participants.map((p) => (
            <ParticipantRow
              key={p.id || p.userId}
              participant={p}
              sessionId={sessionId}
              isOwner={isOwner}
            />
          ))}
        </div>
      ) : (
        <p className="py-2 text-center text-xs text-neutral-400 dark:text-neutral-500">
          No participants yet.
        </p>
      )}
    </div>
  );
}

function ParticipantRow({
  participant,
  sessionId,
  isOwner,
}: {
  participant: SessionParticipant;
  sessionId: string;
  isOwner: boolean;
}) {
  const removeParticipant = useRemoveParticipant();

  const initials = (participant.userName || participant.userEmail || '?')
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join('');

  const handleRemove = async () => {
    try {
      await removeParticipant.mutateAsync({ sessionId, userId: participant.userId });
      toastSuccess('Removed', 'Participant has been removed');
    } catch {
      toastError('Failed', 'Could not remove participant');
    }
  };

  return (
    <div className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
      <div className="flex items-center gap-2 min-w-0">
        <Avatar className="h-6 w-6">
          {participant.userAvatarUrl && (
            <AvatarImage src={participant.userAvatarUrl} alt={participant.userName || ''} />
          )}
          <AvatarFallback className="text-[9px]">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <span className="block truncate text-sm text-neutral-900 dark:text-neutral-100">
            {participant.userName || participant.userEmail}
          </span>
          {participant.userName && participant.userEmail && (
            <span className="block truncate text-xs text-neutral-400 dark:text-neutral-500">
              {participant.userEmail}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Badge variant={participant.role === 'owner' ? 'success' : 'default'}>
          {participant.role}
        </Badge>
        {isOwner && participant.role !== 'owner' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={removeParticipant.isPending}
            className="h-6 px-1.5 text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

function formatRelative(date: Date): string {
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const hours = Math.round(diff / (1000 * 60 * 60));
  if (hours < 1) return 'soon';
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}
