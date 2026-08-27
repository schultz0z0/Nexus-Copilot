import { appError } from '../errors.js';
import type { Actor, ActorRole } from './actor.js';

export type Permission =
  | 'campaign.create' | 'campaign.read' | 'campaign.update'
  | 'campaign.transition' | 'campaign.reopen' | 'campaign.archive'
  | 'participant.manage' | 'participant.owner.manage'
  | 'material.read' | 'material.manage'
  | 'reference.read'
  | 'timeline.read'
  | 'item.create' | 'item.read' | 'item.update' | 'item.transition' | 'item.cancel'
  | 'dependency.read' | 'dependency.manage'
  | 'content.read' | 'content.manage'
  | 'item_artifact.read' | 'item_artifact.manage'
  | 'notification.read' | 'notification.update'
  | 'approval.submit' | 'approval.read' | 'approval.decide' | 'approval.expire'
  | 'item.batch'
  | 'audit.read' | 'membership.manage';

const matrix: Record<Permission, readonly ActorRole[]> = {
  'campaign.create': ['member', 'manager', 'admin'],
  'campaign.read': ['member', 'manager', 'admin'],
  'campaign.update': ['member', 'manager', 'admin'],
  'campaign.transition': ['member', 'manager', 'admin'],
  'campaign.reopen': ['manager', 'admin'],
  'campaign.archive': ['manager', 'admin'],
  'participant.manage': ['member', 'manager', 'admin'],
  'participant.owner.manage': ['manager', 'admin'],
  'material.read': ['member', 'manager', 'admin'],
  'material.manage': ['member', 'manager', 'admin'],
  'reference.read': ['member', 'manager', 'admin'],
  'timeline.read': ['member', 'manager', 'admin'],
  'item.create': ['member', 'manager', 'admin'],
  'item.read': ['member', 'manager', 'admin'],
  'item.update': ['member', 'manager', 'admin'],
  'item.transition': ['member', 'manager', 'admin'],
  'item.cancel': ['member', 'manager', 'admin'],
  'dependency.read': ['member', 'manager', 'admin'],
  'dependency.manage': ['member', 'manager', 'admin'],
  'content.read': ['member', 'manager', 'admin'],
  'content.manage': ['member', 'manager', 'admin'],
  'item_artifact.read': ['member', 'manager', 'admin'],
  'item_artifact.manage': ['member', 'manager', 'admin'],
  'notification.read': ['member', 'manager', 'admin'],
  'notification.update': ['member', 'manager', 'admin'],
  'approval.submit': ['member', 'manager', 'admin'],
  'approval.read': ['member', 'manager', 'admin'],
  'approval.decide': ['manager', 'admin'],
  'approval.expire': ['manager', 'admin'],
  'item.batch': ['manager', 'admin'],
  'audit.read': ['manager', 'admin'],
  'membership.manage': ['admin']
};

export function authorize(actor: Pick<Actor, 'role'>, permission: Permission): void {
  if (!matrix[permission].includes(actor.role)) {
    throw appError('forbidden', 403, `Role does not grant permission ${permission}`, { permission });
  }
}
