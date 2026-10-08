import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { CrewMember } from './CrewMember';

/** Reusable secure crew portal link. token_hash (SHA-256) is used for lookup; token_encrypted (AES-256-GCM, config/crypto) lets the link be re-sent in later emails. */
@Entity('crew_portal_links')
export class CrewPortalLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'crew_member_id' })
  crewMemberId: string;

  @Column({ type: 'text', name: 'token_hash', unique: true })
  tokenHash: string;

  @Column({ type: 'text', name: 'token_encrypted' })
  tokenEncrypted: string;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy: string | null;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', name: 'last_used_at', nullable: true })
  lastUsedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'uuid', name: 'revoked_by', nullable: true })
  revokedBy: string | null;

  @ManyToOne(() => CrewMember, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'crew_member_id' })
  crewMember?: CrewMember;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
