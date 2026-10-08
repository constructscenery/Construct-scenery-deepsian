import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Production } from './Production';
import { User } from './User';

@Entity('unit_lists')
export class UnitList {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'production_id', type: 'uuid', nullable: true })
  productionId: string | null;

  @ManyToOne(() => Production, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'production_id' })
  production?: Production;

  @Column({ name: 'file_name', type: 'text' })
  fileName: string;

  @Column({ name: 'file_url', type: 'text' })
  fileUrl: string;

  @Column({ name: 'file_key', type: 'text', nullable: true })
  fileKey: string | null;

  @Column({ name: 'file_size', type: 'bigint', nullable: true })
  fileSize: string | null;

  @Column({ name: 'file_mime_type', type: 'text', nullable: true, default: 'application/pdf' })
  fileMimeType: string | null;

  @Column({ type: 'date', nullable: true })
  date: string | null;

  @Column({ type: 'text', nullable: true })
  name: string | null;

  @Column({ type: 'text', nullable: true })
  email: string | null;

  @Column({ name: 'phone_number', type: 'text', nullable: true })
  phoneNumber: string | null;

  @Column({ name: 'company_name', type: 'text', nullable: true })
  companyName: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'uploaded_by', type: 'uuid', nullable: true })
  uploadedBy: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'uploaded_by' })
  uploader?: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
