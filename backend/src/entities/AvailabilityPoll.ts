import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Production } from './Production';

@Entity('availability_polls')
export class AvailabilityPoll {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'title' })
  title: string;

  @Column({ type: 'text', name: 'message', nullable: true })
  message: string | null;

  @Column({ type: 'date', name: 'start_date' })
  startDate: string;

  @Column({ type: 'date', name: 'end_date' })
  endDate: string;

  @Column({ type: 'uuid', name: 'production_id', nullable: true })
  productionId: string | null;

  @Column({ type: 'date', name: 'response_deadline', nullable: true })
  responseDeadline: string | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy: string | null;

  @Column({ type: 'timestamptz', name: 'closed_at', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'uuid', name: 'closed_by', nullable: true })
  closedBy: string | null;

  @ManyToOne(() => Production, { nullable: true })
  @JoinColumn({ name: 'production_id' })
  production?: Production;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
