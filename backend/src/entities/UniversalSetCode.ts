import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { SetCodeCategory } from '../enums';
import { User } from './User';

/**
 * CS-03 — set codes available on every production (e.g. management / above-the-line staff).
 * Matched to timesheet_entries.set_number and purchase_orders.set_code by trimmed, case-insensitive text.
 * Deactivate instead of deleting so historic records keep their meaning.
 */
@Entity('universal_set_codes')
export class UniversalSetCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  code: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', default: SetCodeCategory.MANAGEMENT })
  category: SetCodeCategory;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdBy: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
