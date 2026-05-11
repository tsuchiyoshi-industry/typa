export interface UseCase<Request, ResponsePort> {
	execute(request: Request, outputPort: ResponsePort): Promise<void>;
}
