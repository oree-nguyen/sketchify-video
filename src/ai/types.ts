export interface PollinationsAuth {
  appKey: string | null
}

export interface StoryModeRequest {
  topic: string
  targetSceneCount?: number
  language: 'vi'
}

export interface StoryScene {
  order: number
  narrationText: string
  imagePrompt: string
}

export interface StoryScript {
  scenes: StoryScene[]
}

export type StoryProgress =
  | { phase: 'script'; message: string }
  | { phase: 'image' | 'audio' | 'analysis'; scene: number; total: number; message: string }
  | { phase: 'done'; message: string }

export interface StorySceneFailure {
  scene: StoryScene
  stage: 'image' | 'audio' | 'analysis'
  message: string
  frameId?: number
}
