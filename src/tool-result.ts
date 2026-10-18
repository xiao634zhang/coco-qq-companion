export type ToolContent = { type: 'inputText'; text: string } | { type: 'inputImage'; imageUrl: string };
export interface ToolResult { contentItems: ToolContent[] }
export function toolResult(value: unknown, image?: Buffer): ToolResult {
  return { contentItems: [{type:'inputText',text:JSON.stringify(value)}, ...(image ? [{type:'inputImage' as const,imageUrl:'data:image/png;base64,'+image.toString('base64')}] : [])] };
}
export function functionTool(name:string,description:string,properties:Record<string,unknown>={},required:string[]=[]) {
  return {type:'function',name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}};
}
