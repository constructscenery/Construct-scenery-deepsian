import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('it_resources')
export class ITResource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 50, nullable: true })
  type: string | null;

  @Column({ length: 255, nullable: true })
  vendor: string | null;

  @Column({ name: 'subscription_start', type: 'date', nullable: true })
  subscriptionStart: string | null;

  @Column({ name: 'renewal_date', type: 'date', nullable: true })
  renewalDate: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  cost: number | null;

  @Column({ type: 'text', nullable: true })
  credentials: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
