import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('data_sync_history')
export class DataSyncHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'filename', type: 'varchar', length: 255 })
  filename: string;

  @Column({ name: 's3_key', type: 'text' })
  s3Key: string;

  @Column({ name: 's3_url', type: 'text' })
  s3Url: string;

  @Column({ name: 'file_size', type: 'bigint', default: 0 })
  fileSize: number;

  @Column({ name: 'tables_synced', type: 'int', default: 0 })
  tablesSynced: number;

  @Column({ name: 'total_records', type: 'int', default: 0 })
  totalRecords: number;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @Column({ name: 'status', type: 'varchar', length: 50, default: 'SUCCESS' })
  status: string;

  @Column({ name: 'triggered_by_type', type: 'varchar', length: 50, default: 'MANUAL' })
  triggeredByType: string;

  @Column({ name: 'triggered_by_user_id', type: 'uuid', nullable: true })
  triggeredByUserId: string | null;

  @Column({ name: 'triggered_by_user_name', type: 'varchar', length: 255, nullable: true })
  triggeredByUserName: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
