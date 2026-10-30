#include "AircastEncoder.h"

#include "HAL/RunnableThread.h"
#include "Misc/FileHelper.h"
#include "RHIGPUReadback.h"
#include "RenderingThread.h"
#include "TextureResource.h"

namespace
{
	constexpr int32 SlotCount = 4;
	constexpr int32 MaxQueuedFrames = 3;
	constexpr uint32 WakeMs = 100;
}

FAircastEncoder::FAircastEncoder(const FString& Command, FIntPoint FrameSize, const FString& DatasetDir, const FString& DatasetCommand)
	: Size(FrameSize)
	, Dataset(DatasetDir)
{
	Pipe = Command.IsEmpty() ? nullptr : popen(TCHAR_TO_UTF8(*Command), "w");
	Recorder = DatasetCommand.IsEmpty() ? nullptr : popen(TCHAR_TO_UTF8(*DatasetCommand), "w");
	Slots.SetNum(SlotCount);
	for (FSlot& Slot : Slots)
	{
		Slot.Readback = MakeUnique<FRHIGPUTextureReadback>(TEXT("AircastEncoder"));
	}
	Wake = FPlatformProcess::GetSynchEventFromPool();
	Thread = FRunnableThread::Create(this, TEXT("AircastEncoder"));
}

FAircastEncoder::~FAircastEncoder()
{
	FlushRenderingCommands();
	bStopping = true;
	Wake->Trigger();
	Thread->WaitForCompletion();
	delete Thread;
	FPlatformProcess::ReturnSynchEventToPool(Wake);
	if (Pipe)
	{
		pclose(Pipe);
	}
	if (Recorder)
	{
		pclose(Recorder);
	}
}

void FAircastEncoder::Submit(FTextureRenderTargetResource* Resource, const TOptional<FString>& Label)
{
	ENQUEUE_RENDER_COMMAND(AircastEncode)([this, Resource, Label](FRHICommandListImmediate& RHICmdList)
	{
		Drain();
		FSlot& Slot = Slots[Next];
		if (Slot.bBusy)
		{
			return;
		}
		Slot.Readback->EnqueueCopy(RHICmdList, Resource->GetRenderTargetTexture());
		Slot.Label = Label;
		Slot.bBusy = true;
		Next = (Next + 1) % Slots.Num();
	});
}

void FAircastEncoder::Drain()
{
	while (Slots[Oldest].bBusy && Slots[Oldest].Readback->IsReady())
	{
		FSlot& Slot = Slots[Oldest];
		int32 RowPitch = 0;
		const FColor* Rows = static_cast<const FColor*>(Slot.Readback->Lock(RowPitch));
		if (Rows && Queued.Load() < MaxQueuedFrames)
		{
			TArray<FColor> Pixels;
			Pixels.SetNumUninitialized(Size.X * Size.Y);
			for (int32 Row = 0; Row < Size.Y; ++Row)
			{
				FMemory::Memcpy(&Pixels[Row * Size.X], Rows + Row * RowPitch, Size.X * sizeof(FColor));
			}
			Frames.Enqueue({MoveTemp(Pixels), Slot.Label});
			++Queued;
			Wake->Trigger();
		}
		Slot.Readback->Unlock();
		Slot.bBusy = false;
		Oldest = (Oldest + 1) % Slots.Num();
	}
}

uint32 FAircastEncoder::Run()
{
	while (!bStopping)
	{
		Wake->Wait(WakeMs);
		FFrame Frame;
		while (Frames.Dequeue(Frame))
		{
			--Queued;
			if (Pipe && fwrite(Frame.Pixels.GetData(), sizeof(FColor), Frame.Pixels.Num(), Pipe) != static_cast<size_t>(Frame.Pixels.Num()))
			{
				pclose(Pipe);
				Pipe = nullptr;
			}
			if (Frame.Label)
			{
				Record(Frame);
			}
		}
	}
	return 0;
}

void FAircastEncoder::Record(const FFrame& Frame)
{
	if (!Recorder || fwrite(Frame.Pixels.GetData(), sizeof(FColor), Frame.Pixels.Num(), Recorder) != static_cast<size_t>(Frame.Pixels.Num()))
	{
		return;
	}
	const FString Name = FString::Printf(TEXT("%08lld"), Recorded++);
	FFileHelper::SaveStringToFile(*Frame.Label, *FPaths::Combine(Dataset, TEXT("labels"), Name + TEXT(".txt")));
}
