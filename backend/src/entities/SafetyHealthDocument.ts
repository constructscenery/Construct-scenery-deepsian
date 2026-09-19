import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SafetyHealthDocumentStatus, SafetyHealthDocumentType } from '../enums';

@Entity('safety_health_documents')
export class SafetyHealthDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_type', type: 'text' })
  documentType: SafetyHealthDocumentType;

  @Column({ name: 'file_url', type: 'text' })
  fileUrl: string;

  @Column({ name: 'file_key', type: 'text', nullable: true })
  fileKey: string | null;

  @Column({ name: 'file_name', type: 'text' })
  fileName: string;

  @Column({ name: 'file_size', type: 'bigint', nullable: true })
  fileSize: string | null;

  @Column({ name: 'file_mime_type', type: 'text', nullable: true })
  fileMimeType: string | null;

  @Column({ name: 'assessment_date', type: 'date', nullable: true })
  assessmentDate: string | null;

  @Column({ name: 'expiry_date', type: 'date', nullable: true })
  expiryDate: string | null;

  @Column({ name: 'reminder_enabled', type: 'boolean', default: true })
  reminderEnabled: boolean;

  @Column({ name: 'reminder_days', type: 'integer', default: 30 })
  reminderDays: number;

  @Column({ type: 'text', nullable: true })
  location: string | null;

  @Column({ name: 'production_id', type: 'uuid', nullable: true })
  productionId: string | null;

  @Column({ type: 'text', array: true, default: '{}' })
  tags: string[];

  @Column({ type: 'text', default: SafetyHealthDocumentStatus.ACTIVE })
  status: SafetyHealthDocumentStatus;

  @Column({ name: 'public_token', type: 'text', nullable: true, unique: true })
  publicToken: string | null;

  @Column({ name: 'uploaded_by', type: 'uuid', nullable: true })
  uploadedBy: string | null;

  @CreateDateColumn({ name: 'uploaded_at', type: 'timestamptz' })
  uploadedAt: Date;
}