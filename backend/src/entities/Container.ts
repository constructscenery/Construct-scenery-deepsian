import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { Production } from './Production';

@Entity('containers')
export class Container {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'container_number', type: 'text' })
  containerNumber: string;

  @Column({ name: 'container_type', type: 'text', default: '20ft Storage Container' })
  containerType: string;

  @Column({ type: 'text', nullable: true })
  size: string | null;

  @Column({ type: 'text', default: 'available' })
  status: string;

  @Column({ name: 'ownership_status', type: 'text', default: 'owned' })
  ownershipStatus: string;

  @Column({ type: 'text', nullable: true })
  location: string | null;

  @Column({ name: 'assigned_production_id', type: 'uuid', nullable: true })
  assignedProductionId: string | null;

  @ManyToOne(() => Production, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_production_id' })
  production: Production | null;

  @Column({ type: 'text', nullable: true })
  supplier: string | null;

  @Column({ name: 'hire_start_date', type: 'date', nullable: true })
  hireStartDate: string | null;

  @Column({ name: 'hire_end_date', type: 'date', nullable: true })
  hireEndDate: string | null;

  @Column({ name: 'weekly_cost', type: 'decimal', precision: 10, scale: 2, nullable: true })
  weeklyCost: number | null;

  @Column({ type: 'text', default: 'good' })
  condition: string;

  @Column({ name: 'contents_description', type: 'text', nullable: true })
  contentsDescription: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'is_archived', default: false })
  isArchived: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
