import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { FreelancerCallPriority } from '../enums';
import { encryptTransformer } from '../utils/crypto';

@Entity('freelancer_contacts')
export class FreelancerContact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'full_name', type: 'text' })
  fullName: string;

  @Column({ type: 'text', nullable: true })
  email: string | null;

  @Column({ type: 'text', nullable: true, transformer: encryptTransformer })
  phone: string | null;

  @Column({ type: 'text', nullable: true })
  skills: string | null;

  @Column({ type: 'text', nullable: true, transformer: encryptTransformer })
  notes: string | null;

  @Column({ name: 'is_favourite', default: false })
  isFavourite: boolean;

  @Column({ name: 'call_priority', type: 'text', default: FreelancerCallPriority.BACKUP })
  callPriority: FreelancerCallPriority;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}