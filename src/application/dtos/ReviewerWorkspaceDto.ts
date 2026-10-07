export type {
	ReviewCommonItem as ReviewCommonItemDto,
	ReviewerRow as ReviewerRowDto,
	ReviewObjective as ReviewObjectiveDto,
} from "../../domain/entities/ReviewerWorkspace";
export interface ReviewPeriodDto {
	id: number;
	periodName: string;
	startDate: string;
	endDate: string;
	isActive: boolean;
}
