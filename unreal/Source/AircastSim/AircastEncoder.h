#pragma once

#include "CoreMinimal.h"
#include "HAL/Runnable.h"
#include "Containers/Queue.h"

#include <cstdio>

class FRHIGPUTextureReadback;
class FRunnableThread;
class FTextureRenderTargetResource;

class FAircastEncoder final : public FRunnable
{
public:
	FAircastEncoder(const FString& Command, FIntPoint Size, const FString& Dataset, const FString& DatasetCommand);
	virtual ~FAircastEncoder() override;
	void Submit(FTextureRenderTargetResource* Resource, const TOptional<FString>& Label);
	virtual uint32 Run() override;

private:
	struct FSlot
	{
		TUniquePtr<FRHIGPUTextureReadback> Readback;
		TOptional<FString> Label;
		bool bBusy = false;
	};

	struct FFrame
	{
		TArray<FColor> Pixels;
		TOptional<FString> Label;
	};

	void Record(const FFrame& Frame);

	void Drain();

	FILE* Pipe = nullptr;
	FIntPoint Size;
	TArray<FSlot> Slots;
	int32 Next = 0;
	int32 Oldest = 0;
	TQueue<FFrame, EQueueMode::Spsc> Frames;
	FString Dataset;
	FILE* Recorder = nullptr;
	int64 Recorded = 0;
	TAtomic<int32> Queued{0};
	TAtomic<bool> bStopping{false};
	FEvent* Wake = nullptr;
	FRunnableThread* Thread = nullptr;
};
