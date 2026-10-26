import type { Result } from "../../domain/Result";

export interface UseCase<Request, ResponsePort> {
	execute(request: Request, outputPort: ResponsePort): Promise<void>;
}

/**
 * 業務の上で失敗し得るユースケース。失敗は例外ではなく、起こり得る種類だけを E の型で返す
 * (成功したときの結果は outputPort に渡す)。通信の失敗など、想定していない失敗は例外のまま。
 */
export interface FallibleUseCase<Request, ResponsePort, E> {
	execute(request: Request, outputPort: ResponsePort): Promise<Result<void, E>>;
}
