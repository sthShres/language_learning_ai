import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const groqApiKey = Deno.env.get("GROQ_API_KEY")!;

    if (!groqApiKey) {
      throw new Error("GROQ_API_KEY is not set");
    }

    const authHeader = req.headers.get("Authorization") ?? "";

    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    const { inputAudio } = await req.json();

    if (!inputAudio?.data || !inputAudio?.format) {
      return new Response(
        JSON.stringify({ error: "Missing audio data" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Convert base64 audio to bytes
    const binaryString = atob(inputAudio.data);
    const bytes = new Uint8Array(binaryString.length);

    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Create form data for Groq Whisper
    const formData = new FormData();

    formData.append(
      "file",
      new Blob([bytes], {
        type: `audio/${inputAudio.format}`,
      }),
      `audio.${inputAudio.format}`,
    );

    formData.append("model", "whisper-large-v3");

    // Nepali language
    formData.append("language", "ne");

    // Context prompt
    formData.append(
      "prompt",
      `
This audio contains Nepalbhasa (Newari) words written in Nepali script.

Use simple Nepali pronunciation spellings suitable for Nepali text-to-speech (ne-NP).

Examples:
ज्वजलपा -> जोजोलापा
म्हं फु ला -> मं फुला

Return only the transcription text.
`,
    );

    const response = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
        },
        body: formData,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error("Groq API Error:", response.status, errorText);

      throw new Error(
        `Groq API Error: ${response.status} - ${errorText}`,
      );
    }

    const data = await response.json();

    let transcript = data.text || "";

    // Optional cleanup replacements for better TTS
    const replacements: Record<string, string> = {
      "ज्वजलपा": "जोजोलापा",
      "म्हं फु ला": "मं फुला",
      "म्हंफुला": "मं फुला",
    };

    for (const [key, value] of Object.entries(replacements)) {
      transcript = transcript.replaceAll(key, value);
    }

    return new Response(
      JSON.stringify({
        transcript,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error";

    console.error("Edge Function Error:", message);

    return new Response(
      JSON.stringify({
        error: message,
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});