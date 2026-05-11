export interface OutputPort<Response> {
	present(response: Response): void;
}
