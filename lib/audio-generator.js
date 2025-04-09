import { exec } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { promisify } from 'util';
import { platform } from 'os';

const execPromise = promisify(exec);

/**
 * Check if system has text-to-speech capabilities
 * @returns {Promise<boolean>} Whether TTS is available
 */
export async function checkTTSAvailability() {
  const os = platform();
  
  try {
    if (os === 'darwin') {
      // Check for macOS 'say' command
      await execPromise('say -v ? | head -n 1');
      return true;
    } else if (os === 'win32') {
      // Check for Windows PowerShell speech capability
      await execPromise('powershell.exe -Command "Add-Type -AssemblyName System.Speech" 2> $null');
      return true;
    } else if (os === 'linux') {
      // Check for common Linux TTS tools
      try {
        await execPromise('which espeak || which festival || which pico2wave');
        return true;
      } catch (error) {
        return false;
      }
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Prepare text for speech by removing markdown and formatting
 * @param {string} text - Text to prepare
 * @returns {string} Processed text
 */
function prepareTextForSpeech(text) {
  // Remove markdown formatting
  let processedText = text
    .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
    .replace(/\*(.*?)\*/g, '$1') // Remove italic
    .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Remove links but keep text
    .replace(/#{1,6}\s+(.*)/g, '$1'); // Remove headers but keep text
    
  // Remove code blocks
  processedText = processedText.replace(/```[\s\S]*?```/g, 'Code block omitted.');
  
  // Clean up extra spaces and line breaks for better speech
  processedText = processedText
    .replace(/\n\n+/g, '. ') // Replace multiple line breaks with period and space
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .trim();
    
  return processedText;
}

/**
 * Generate audio file from text using system text-to-speech
 * @param {string} text - Text to convert to speech
 * @param {string} outputPath - Path to save audio file
 * @param {Object} options - TTS options
 * @param {string} [options.voice] - Voice to use (system dependent)
 * @param {number} [options.rate=180] - Speaking rate (words per minute, macOS)
 * @returns {Promise<string>} Path to generated audio file
 */
export async function generateAudio(text, outputPath, options = {}) {
  // Make sure text is prepared for speech
  const processedText = prepareTextForSpeech(text);
  
  // Ensure directory exists
  await fs.ensureDir(path.dirname(outputPath));
  
  const os = platform();
  let command;
  
  if (os === 'darwin') {
    // macOS
    const voice = options.voice ? `-v "${options.voice}"` : '';
    const rate = options.rate ? `-r ${options.rate}` : '-r 180';
    // Use AIFF format on macOS which is high quality and supported by default
    const audioFile = outputPath.endsWith('.aiff') ? outputPath : `${outputPath}.aiff`;
    
    command = `say ${voice} ${rate} -o "${audioFile}" "${processedText.replace(/"/g, '\\"')}"`;
  } else if (os === 'win32') {
    // Windows
    // Create a PowerShell script for TTS
    const psScript = `
      Add-Type -AssemblyName System.Speech
      $synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
      $synthesizer.SetOutputToWaveFile("${outputPath}.wav")
      ${options.voice ? `$synthesizer.SelectVoice("${options.voice}")` : ''}
      ${options.rate ? `$synthesizer.Rate = ${Math.min(10, Math.max(-10, options.rate/20 - 5))}` : ''}
      $synthesizer.Speak("${processedText.replace(/"/g, '\`"')}")
      $synthesizer.Dispose()
    `;
    
    const scriptPath = `${outputPath}.ps1`;
    await fs.writeFile(scriptPath, psScript);
    command = `powershell.exe -ExecutionPolicy Bypass -File "${scriptPath}"`;
  } else if (os === 'linux') {
    // Linux - try common TTS engines
    let ttsCommand = '';
    
    try {
      const { stdout } = await execPromise('which espeak || which festival || which pico2wave');
      if (stdout.includes('espeak')) {
        const voice = options.voice ? `-v ${options.voice}` : '';
        const rate = options.rate ? `-s ${options.rate}` : '';
        ttsCommand = `espeak ${voice} ${rate} -w "${outputPath}.wav" "${processedText.replace(/"/g, '\\"')}"`;
      } else if (stdout.includes('festival')) {
        // Festival is more limited in options
        const tmpFile = `${outputPath}.txt`;
        await fs.writeFile(tmpFile, processedText);
        ttsCommand = `cat "${tmpFile}" | festival --tts --output-file="${outputPath}.wav"`;
      } else if (stdout.includes('pico2wave')) {
        ttsCommand = `pico2wave -w="${outputPath}.wav" "${processedText.replace(/"/g, '\\"')}"`;
      }
    } catch (error) {
      throw new Error('No supported TTS engine found on Linux');
    }
    
    if (!ttsCommand) {
      throw new Error('No supported TTS engine found');
    }
    
    command = ttsCommand;
  } else {
    throw new Error(`Unsupported operating system: ${os}`);
  }
  
  try {
    await execPromise(command);
    return outputPath + (os === 'darwin' ? '.aiff' : '.wav');
  } catch (error) {
    console.error('Error generating audio:', error.message);
    throw new Error(`Failed to generate audio: ${error.message}`);
  }
}

/**
 * Generate audio from a summary with key points
 * @param {Object} summary - Summary object with shortSummary and keyPoints
 * @param {string} outputPath - Path to save audio file
 * @param {Object} options - TTS options
 * @returns {Promise<string>} Path to generated audio file
 */
export async function generateSummaryAudio(summary, outputPath, options = {}) {
  // Create a speech-friendly version of the summary
  let speechText = `Summary: ${summary.shortSummary}\n\n`;
  
  if (summary.keyPoints && summary.keyPoints.length > 0) {
    speechText += "Key points: \n";
    
    // Add each key point with a pause
    summary.keyPoints.forEach((point, index) => {
      speechText += `Point ${index + 1}: ${point}.\n`;
    });
  }
  
  // Generate audio
  return generateAudio(speechText, outputPath, options);
}

/**
 * Get available voices on the system
 * @returns {Promise<string[]>} List of available voices
 */
export async function getAvailableVoices() {
  const os = platform();
  
  try {
    if (os === 'darwin') {
      // macOS
      const { stdout } = await execPromise('say -v ?');
      return stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => line.split(' ')[0]);
    } else if (os === 'win32') {
      // Windows
      const psScript = `
        Add-Type -AssemblyName System.Speech
        $synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
        $synthesizer.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
      `;
      const { stdout } = await execPromise(`powershell.exe -Command "${psScript}"`);
      return stdout.split('\n').filter(line => line.trim());
    } else if (os === 'linux') {
      // Linux - depends on the engine
      try {
        const { stdout: espeakCheck } = await execPromise('which espeak');
        if (espeakCheck) {
          const { stdout } = await execPromise('espeak --voices=en');
          return stdout
            .split('\n')
            .filter(line => line.trim() && !line.startsWith('Pty'))
            .map(line => {
              const parts = line.trim().split(' ');
              return parts[3] || parts[0]; // Voice name is usually in position 3 or 0
            });
        }
      } catch (error) {
        return []; // No espeak or couldn't get voices
      }
    }
    
    return [];
  } catch (error) {
    console.error('Error getting available voices:', error);
    return [];
  }
}