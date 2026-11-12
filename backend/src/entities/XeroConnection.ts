import {
  Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { XeroConnectionStatus } from '../enums';
import { User } from './User';
import { encryptTransformer } from '../utils/crypto';

/** The single Xero organisation connected to theOffice (one row). Tokens are encrypted at rest. */
@Entity('xero_connection')
export class XeroConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'boolean', default: true, unique: true })
  singleton: boolean;

  @Column({ name: 'tenant_id', type: 'text' })
  tenantId: string;

  @Column({ name: 'tenant_name', type: 'text', nullable: true })
  tenantName: string | null;

  @Column({ name: 'access_token', type: 'text', nullable: true, transformer: encryptTransformer })
  accessToken: string | null;

  @Column({ name: 'refresh_token', type: 'text', nullable: true, transformer: encryptTransformer })
  refreshToken: string | null;

  @Column({ name: 'access_token_expires_at', type: 'timestamptz', nullable: true })
  accessTokenExpiresAt: Date | null;

  @Column({ type: 'text', default: XeroConnectionStatus.CONNECTED })
  status: XeroConnectionStatus;

  @Column({ name: 'connected_by', type: 'uuid', nullable: true })
  connectedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'connected_by' })
  connectedBy: User | null;

  @Column({ name: 'connected_at', type: 'timestamptz' })
  connectedAt: Date;

  /** Start time of the last successful sync — the If-Modified-Since for the next one. */
  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @Column({ name: 'last_sync_attempt_at', type: 'timestamptz', nullable: true })
  lastSyncAttemptAt: Date | null;

  @Column({ name: 'last_sync_status', type: 'text', nullable: true })
  lastSyncStatus: 'success' | 'failed' | null;

  @Column({ name: 'last_sync_error', type: 'text', nullable: true })
  lastSyncError: string | null;

  @Column({ name: 'last_sync_count', type: 'int', nullable: true })
  lastSyncCount: number | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
